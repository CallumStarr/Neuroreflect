// Everything that needs the desktop: reminders, the system tray, starting at
// sign-in, quick capture from anywhere, one running copy and the window's size.
//
// Reminders: the window works out what is due (only it can read the journal)
// and hands the list over with `set_reminders`. A background thread here keeps
// time and shows each one as a system notification, so they arrive while the
// window is hidden in the tray and its timers are slowed. Reminders are kept in
// memory only; nothing about them is written to disk on this side.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Builder, Emitter, Manager, Runtime, State, WindowEvent, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

/// Started by the sign-in item: open straight into the tray, without a window.
const HIDDEN_ARG: &str = "--hidden";
/// A reminder this late (the computer was asleep, say) is left for the window
/// to show as missed rather than popping up out of context.
const LATE_LIMIT_MS: i64 = 5 * 60 * 1000;
const TICK: Duration = Duration::from_secs(5);
/// If the window doesn't answer a quit request in this time, quit anyway.
const QUIT_GRACE: Duration = Duration::from_secs(4);

#[derive(Clone, Deserialize)]
pub struct Reminder {
    pub id: String,
    /// Epoch milliseconds.
    pub at: i64,
    pub title: String,
    pub body: String,
}

#[derive(Default)]
pub struct Reminders {
    items: Mutex<Vec<Reminder>>,
    /// Shown since the window last asked, so it can record them.
    fired: Mutex<Vec<String>>,
    /// Shown at any point in this run, so nothing is shown twice.
    shown: Mutex<HashSet<String>>,
}

pub struct Prefs {
    keep_in_tray: AtomicBool,
    told_about_tray: AtomicBool,
    quitting: AtomicBool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPrefs {
    keep_in_tray: bool,
    global_capture: bool,
    start_at_login: bool,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn capture_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space)
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Asks the window to save anything unsaved and quit; quits anyway if it doesn't.
fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    let prefs = app.state::<Prefs>();
    if prefs.quitting.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = app.emit("quit-requested", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_GRACE);
        handle.exit(0);
    });
}

#[tauri::command]
pub fn set_reminders(state: State<'_, Arc<Reminders>>, items: Vec<Reminder>) {
    *state.items.lock().unwrap() = items;
}

#[tauri::command]
pub fn take_fired_reminders(state: State<'_, Arc<Reminders>>) -> Vec<String> {
    std::mem::take(&mut *state.fired.lock().unwrap())
}

#[tauri::command]
pub fn set_desktop_prefs(app: AppHandle, prefs: DesktopPrefs) -> Result<(), String> {
    app.state::<Prefs>().keep_in_tray.store(prefs.keep_in_tray, Ordering::SeqCst);

    let autostart = app.autolaunch();
    let enabled = autostart.is_enabled().unwrap_or(false);
    if prefs.start_at_login && !enabled {
        autostart.enable().map_err(|e| format!("Couldn't turn on starting at sign-in: {e}"))?;
    } else if !prefs.start_at_login && enabled {
        autostart.disable().map_err(|e| format!("Couldn't turn off starting at sign-in: {e}"))?;
    }

    let shortcuts = app.global_shortcut();
    let shortcut = capture_shortcut();
    let registered = shortcuts.is_registered(shortcut);
    if prefs.global_capture && !registered {
        shortcuts
            .register(shortcut)
            .map_err(|e| format!("Ctrl+Alt+Space is already used by another app, so quick capture can't use it: {e}"))?;
    } else if !prefs.global_capture && registered {
        let _ = shortcuts.unregister(shortcut);
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.state::<Prefs>().quitting.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn start_reminder_clock(app: AppHandle, reminders: Arc<Reminders>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(TICK);
        let now = now_ms();
        let due: Vec<Reminder> = {
            let items = reminders.items.lock().unwrap();
            let shown = reminders.shown.lock().unwrap();
            items
                .iter()
                .filter(|r| r.at <= now && now - r.at <= LATE_LIMIT_MS && !shown.contains(&r.id))
                .cloned()
                .collect()
        };
        for r in due {
            reminders.shown.lock().unwrap().insert(r.id.clone());
            reminders.fired.lock().unwrap().push(r.id.clone());
            if let Err(e) = app.notification().builder().title(&r.title).body(&r.body).show() {
                eprintln!("NeuroReflect: a reminder could not be shown: {e}");
            }
            let _ = app.emit("reminder-fired", r.id.clone());
        }
    });
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open NeuroReflect", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "Quick capture", true, None::<&str>)?;
    let planner = MenuItem::with_id(app, "planner", "Planner", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit NeuroReflect", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &capture, &planner, &separator, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("NeuroReflect")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "capture" => {
                show_main(app);
                let _ = app.emit("quick-capture", ());
            }
            "planner" => {
                show_main(app);
                let _ = app.emit("open-planner", ());
            }
            "quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

pub fn install(builder: Builder<Wry>) -> Builder<Wry> {
    use tauri_plugin_window_state::StateFlags;
    builder
        // Must be registered first. Opening the app again focuses the window that
        // is already open, so only one copy of the journal is ever unlocked.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        // The window's size and place are remembered, but not whether it was
        // hidden: that is decided at each start.
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(StateFlags::all() & !StateFlags::VISIBLE).build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN_ARG])))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && *shortcut == capture_shortcut() {
                        show_main(app);
                        let _ = app.emit("quick-capture", ());
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .manage(Arc::new(Reminders::default()))
        .manage(Prefs { keep_in_tray: AtomicBool::new(true), told_about_tray: AtomicBool::new(false), quitting: AtomicBool::new(false) })
        .setup(|app| {
            build_tray(app)?;
            let reminders = app.state::<Arc<Reminders>>().inner().clone();
            start_reminder_clock(app.handle().clone(), reminders);
            let hidden = std::env::args().any(|a| a == HIDDEN_ARG);
            if !hidden {
                show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let prefs = app.state::<Prefs>();
                if prefs.quitting.load(Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                if prefs.keep_in_tray.load(Ordering::SeqCst) {
                    let _ = window.hide();
                    let _ = app.emit("window-hidden", ());
                    if !prefs.told_about_tray.swap(true, Ordering::SeqCst) {
                        let _ = app
                            .notification()
                            .builder()
                            .title("NeuroReflect is still running")
                            .body("It's in the system tray so reminders can reach you. Quit from the tray icon, or turn this off in Settings.")
                            .show();
                    }
                } else {
                    request_quit(app);
                }
            }
        })
}

use std::fs;
use std::path::{Path, PathBuf};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn import_photo(app: AppHandle, mouse_id: String, source: String) -> Result<String, String> {
    let source_path = PathBuf::from(&source);
    if !source_path.is_file() {
        return Err("Selected photo was not found.".into());
    }

    let ext = source_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_lowercase();
    if !matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "heic" | "tif" | "tiff" | "bmp"
    ) {
        return Err("Unsupported image type. Use jpg, png, webp, or gif.".into());
    }

    let dir = app
        .path()
        .resolve("photos", BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let dest = dir.join(format!("{mouse_id}.{ext}"));
    fs::copy(&source_path, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn write_export(path: String, contents: String) -> Result<(), String> {
    let dest = Path::new(&path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(dest, contents).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create mice and weights tables",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "app settings including baseline percent",
            sql: include_str!("../migrations/002_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "optional per-mouse plot color",
            sql: include_str!("../migrations/003_mouse_color.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:mouseweight.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![import_photo, write_export])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

fn photos_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .resolve("photos", BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    dir.canonicalize().map_err(|e| e.to_string())
}

fn sanitize_mouse_id(mouse_id: &str) -> Result<(), String> {
    if mouse_id.is_empty()
        || mouse_id.len() > 80
        || !mouse_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid photo id.".into());
    }
    Ok(())
}

fn image_ext(ext: &str) -> Result<String, String> {
    let ext = ext.to_lowercase();
    if !matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "heic" | "tif" | "tiff" | "bmp"
    ) {
        return Err("Unsupported image type. Use jpg, png, webp, or gif.".into());
    }
    Ok(ext)
}

#[tauri::command]
fn import_photo(app: AppHandle, mouse_id: String, source: String) -> Result<String, String> {
    sanitize_mouse_id(&mouse_id)?;
    let source_path = PathBuf::from(&source);
    if !source_path.is_file() {
        return Err("Selected photo was not found.".into());
    }

    let ext = image_ext(
        source_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("jpg"),
    )?;

    let dir = photos_dir(&app)?;
    let dest = dir.join(format!("{mouse_id}.{ext}"));
    fs::copy(&source_path, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn read_photo_base64(app: AppHandle, path: String) -> Result<String, String> {
    let dir = photos_dir(&app)?;
    let file = PathBuf::from(&path);
    let canonical = file.canonicalize().map_err(|_| "Selected photo was not found.".to_string())?;
    if !canonical.starts_with(&dir) {
        return Err("Photo is outside the app folder.".into());
    }
    let bytes = fs::read(&canonical).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
fn write_photo(app: AppHandle, mouse_id: String, ext: String, data_base64: String) -> Result<String, String> {
    sanitize_mouse_id(&mouse_id)?;
    let ext = image_ext(&ext)?;
    let bytes = STANDARD
        .decode(data_base64.trim())
        .map_err(|_| "Photo data was not valid.".to_string())?;
    let dir = photos_dir(&app)?;
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with(&format!("{mouse_id}.")) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    let dest = dir.join(format!("{mouse_id}.{ext}"));
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_photo_files(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let dir = photos_dir(&app)?;
    for path in paths {
        let file = PathBuf::from(&path);
        let Ok(canonical) = file.canonicalize() else {
            continue;
        };
        if canonical.starts_with(&dir) {
            let _ = fs::remove_file(canonical);
        }
    }
    Ok(())
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
        Migration {
            version: 4,
            description: "colonies, device state, and sync cursors",
            sql: include_str!("../migrations/004_colonies.sql"),
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
        .invoke_handler(tauri::generate_handler![
            import_photo,
            read_photo_base64,
            write_photo,
            delete_photo_files,
            write_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

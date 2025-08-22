use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use xs::store::{FollowOption, Frame, ReadOptions, Store as XsStore, ZERO_CONTEXT};

type Store = Arc<Mutex<XsStore>>;

#[derive(Debug, Serialize, Deserialize)]
pub struct AppendRequest {
    pub topic: String,
    pub content: String,
    pub meta: Option<HashMap<String, serde_json::Value>>,
}

#[tauri::command]
async fn append_event(
    store: State<'_, Store>,
    app: AppHandle,
    request: AppendRequest,
) -> Result<String, String> {
    let store = store.lock().await;

    // Insert content into CAS if provided
    let hash = if !request.content.is_empty() {
        Some(
            store
                .cas_insert(&request.content.into_bytes())
                .await
                .map_err(|e| format!("Failed to insert content: {e}"))?,
        )
    } else {
        None
    };

    let context_id = ZERO_CONTEXT; // Use system context for now
    let frame_id = scru128::new();

    let frame = Frame {
        id: frame_id,
        context_id,
        topic: request.topic.clone(),
        hash,
        meta: request
            .meta
            .map(|m| serde_json::Value::Object(m.into_iter().collect())),
        ttl: None,
    };

    let appended_frame = store
        .append(frame)
        .map_err(|e| format!("Failed to append frame: {e}"))?;

    // Emit the frame to frontend via Tauri events
    app.emit("frame", &appended_frame)
        .map_err(|e| format!("Failed to emit frame: {e}"))?;

    Ok(frame_id.to_string())
}

#[tauri::command]
async fn get_cas_content(store: State<'_, Store>, hash: String) -> Result<String, String> {
    let store = store.lock().await;

    let integrity = hash
        .parse::<ssri::Integrity>()
        .map_err(|e| format!("Invalid hash format: {e}"))?;

    let content = store
        .cas_read(&integrity)
        .await
        .map_err(|e| format!("Failed to read content: {e}"))?;

    String::from_utf8(content).map_err(|e| format!("Invalid UTF-8 content: {e}"))
}

#[tauri::command]
fn log_message(level: String, message: String) {
    match level.as_str() {
        "error" => eprintln!("[FRONTEND ERROR] {message}"),
        "warn" => eprintln!("[FRONTEND WARN] {message}"),
        _ => println!("[FRONTEND LOG] {message}"),
    }
}

async fn initialize_store(app: &AppHandle) -> Result<Store> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?;

    tokio::fs::create_dir_all(&app_data_dir).await?;
    let store_path = app_data_dir.join("store");

    let store = XsStore::new(store_path);
    let store = Arc::new(Mutex::new(store));

    // Check if we need to create default yak
    let store_lock = store.lock().await;
    let mut has_yak = false;

    // Create read options to scan all frames
    let read_options = ReadOptions::builder().follow(FollowOption::Off).build();

    let mut rx = store_lock.read(read_options).await;
    while let Some(frame) = rx.recv().await {
        if frame.topic == "yak.create" {
            has_yak = true;
            break;
        }
    }

    if !has_yak {
        println!("No yak found, creating default yak...");
        // Create default yak
        let yak_frame = Frame {
            id: scru128::new(),
            context_id: ZERO_CONTEXT,
            topic: "yak.create".to_string(),
            hash: None,
            meta: None,
            ttl: None,
        };

        println!("Creating yak frame: {yak_frame:?}");
        let appended_yak = store_lock
            .append(yak_frame)
            .map_err(|e| anyhow::anyhow!("Failed to append yak: {}", e))?;

        println!("Yak appended successfully: {appended_yak:?}");

        // Emit to frontend
        app.emit("frame", &appended_yak).unwrap_or_else(|e| {
            eprintln!("Failed to emit initial yak frame: {e}");
        });

        println!("Yak frame emitted to frontend");
    } else {
        println!("Existing yak found, skipping creation");
    }

    drop(store_lock);

    // Start streaming existing events to frontend with a small delay
    let app_clone = app.clone();
    let store_clone = store.clone();
    tokio::spawn(async move {
        // Give frontend time to set up listeners
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        if let Err(e) = stream_existing_events(app_clone, store_clone).await {
            eprintln!("Failed to stream existing events: {e}");
        }
    });

    Ok(store)
}

async fn stream_existing_events(app: AppHandle, store: Store) -> Result<()> {
    println!("Starting to stream existing events...");
    let store = store.lock().await;

    // Create read options to get all existing frames without following new ones
    let read_options = ReadOptions::builder().follow(FollowOption::Off).build();

    println!("Reading frames from store...");
    let mut rx = store.read(read_options).await;
    let mut count = 0;
    while let Some(frame) = rx.recv().await {
        count += 1;
        println!("Streaming frame {count}: {frame:?}");
        app.emit("frame", &frame)?;
    }

    println!("Finished streaming {count} existing events");
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match initialize_store(&app_handle).await {
                    Ok(store) => {
                        app_handle.manage(store);
                    }
                    Err(e) => {
                        eprintln!("Failed to initialize store: {e}");
                        std::process::exit(1);
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            append_event,
            get_cas_content,
            log_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_append_event_and_get_content() {
        let temp_dir = tempdir().unwrap();
        let store = XsStore::new(temp_dir.path().to_path_buf());
        let store = Arc::new(Mutex::new(store));

        // Test appending an event
        let _request = AppendRequest {
            topic: "test.topic".to_string(),
            content: "test content".to_string(),
            meta: None,
        };

        // We can't easily test the full command without Tauri app context,
        // but we can test the core logic
        let store_lock = store.lock().await;

        // Test CAS insertion
        let hash = store_lock.cas_insert(b"test content").await.unwrap();

        // Test CAS retrieval
        let retrieved = store_lock.cas_read(&hash).await.unwrap();
        assert_eq!(retrieved, b"test content");

        // Test frame creation and storage
        let frame = Frame {
            id: scru128::new(),
            context_id: ZERO_CONTEXT,
            topic: "test.topic".to_string(),
            hash: Some(hash),
            meta: None,
            ttl: None,
        };

        let appended = store_lock.append(frame).unwrap();
        assert_eq!(appended.topic, "test.topic");
        assert!(appended.hash.is_some());
    }
}

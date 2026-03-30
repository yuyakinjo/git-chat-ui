#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let main_window = app.get_webview_window("main").ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::NotFound, "Main window is missing.")
            })?;

            backend::setup_main_window(&main_window).map_err(std::io::Error::other)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backend::health,
            backend::open_external_url,
            backend::sync_window_appearance,
            backend::get_repositories,
            backend::mark_recent_repository,
            backend::get_repository_github_url,
            backend::get_repository_mutation_safety,
            backend::get_branches,
            backend::get_commits,
            backend::get_commit_detail,
            backend::get_branch_diff_detail,
            backend::get_working_tree_diff_detail,
            backend::get_working_tree_status,
            backend::stage_file,
            backend::unstage_file,
            backend::stash_file,
            backend::get_stashes,
            backend::rename_stash,
            backend::checkout,
            backend::create_branch,
            backend::merge_branches,
            backend::delete_branch,
            backend::prepare_pull_request,
            backend::create_pull_request,
            backend::commit,
            backend::push,
            backend::get_fingerprint,
            backend::get_config,
            backend::save_config,
            backend::validate_open_ai_token,
            backend::get_open_ai_models,
            backend::validate_claude_code_token,
            backend::generate_title
        ])
        .run(tauri::generate_context!())
        .expect("failed to run app");
}

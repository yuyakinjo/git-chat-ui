#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            backend::health,
            backend::get_repositories,
            backend::mark_recent_repository,
            backend::get_branches,
            backend::get_commits,
            backend::get_commit_detail,
            backend::get_branch_diff_detail,
            backend::get_working_tree_status,
            backend::stage_file,
            backend::unstage_file,
            backend::stash_file,
            backend::get_stashes,
            backend::checkout,
            backend::commit,
            backend::push,
            backend::get_fingerprint,
            backend::get_config,
            backend::save_config,
            backend::generate_title
        ])
        .run(tauri::generate_context!())
        .expect("failed to run app");
}

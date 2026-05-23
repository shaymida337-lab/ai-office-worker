# Google Apps Script — Drive folders

## Create all Drive folders in one click

1. Open [Google Drive](https://drive.google.com).
2. Click **New** → **More** → **Google Apps Script**.
3. Name the project `AI Office Worker Setup`.
4. Open `create-drive-folders.gs` from this repo and **paste** into the script editor.
5. Select function **`createAiOfficeWorkerFolders`** in the toolbar dropdown.
6. Click **Run** (▶).
7. Click **Review permissions** → choose your Google account → **Allow**.
8. **View → Execution log** — you should see URLs for each folder.

## Get folder ID for Make.com

1. Run function **`getRootFolderId`** the same way.
2. Copy `ROOT_FOLDER_ID` from the log into your `Config` sheet (add row `drive_root_folder_id` if needed).

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Authorization required | Run again and complete OAuth |
| Folder already exists | Script skips duplicates safely |
| Wrong Google account | Switch account in Drive before running |

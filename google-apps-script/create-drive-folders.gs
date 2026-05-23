/**
 * AI Office Worker — Create Google Drive folder structure
 *
 * HOW TO RUN (beginner):
 * 1. Open https://drive.google.com
 * 2. New → More → Google Apps Script
 * 3. Delete default code, paste this entire file
 * 4. Click Run → createAiOfficeWorkerFolders
 * 5. Approve permissions when asked
 * 6. View → Logs to see created folder links
 */

var ROOT_FOLDER_NAME = 'AI-Office-Worker';

var FOLDER_TREE = [
  'Invoices',
  'Payment-Requests',
  'Receipts',
  'Other',
  'WhatsApp-Uploads/Inbox',
  'Reports/Missing-Invoices',
  'Reports/Daily-Summaries',
  'Manual-Review'
];

var EXAMPLE_SUPPLIER = '_דוגמה-ספק';

/**
 * Main entry — run this function from the Apps Script editor.
 */
function createAiOfficeWorkerFolders() {
  var root = getOrCreateFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  Logger.log('Root folder: ' + root.getName() + ' — ' + root.getUrl());

  FOLDER_TREE.forEach(function (path) {
    var folder = ensurePath_(root, path);
    Logger.log('Created/verified: ' + path + ' — ' + folder.getUrl());
  });

  // Example supplier subfolders (optional; Make.com can create per supplier later)
  var supplierPaths = [
    'Invoices/' + EXAMPLE_SUPPLIER,
    'Payment-Requests/' + EXAMPLE_SUPPLIER,
    'Receipts/' + EXAMPLE_SUPPLIER
  ];

  supplierPaths.forEach(function (path) {
    var folder = ensurePath_(root, path);
    Logger.log('Example supplier folder: ' + path + ' — ' + folder.getUrl());
  });

  Logger.log('Done. Open Drive and confirm folder: ' + ROOT_FOLDER_NAME);
}

/**
 * Returns root folder ID for Make.com (run once, copy from logs).
 */
function getRootFolderId() {
  var root = getOrCreateFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  Logger.log('ROOT_FOLDER_ID=' + root.getId());
  Logger.log('ROOT_FOLDER_URL=' + root.getUrl());
}

function getOrCreateFolder_(parent, name) {
  var iter = parent.getFoldersByName(name);
  if (iter.hasNext()) {
    return iter.next();
  }
  return parent.createFolder(name);
}

function ensurePath_(root, path) {
  var parts = path.split('/');
  var current = root;
  for (var i = 0; i < parts.length; i++) {
    current = getOrCreateFolder_(current, parts[i]);
  }
  return current;
}

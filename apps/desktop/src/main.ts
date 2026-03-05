import {
    app,
    BrowserWindow,
    Menu,
    ipcMain,
    dialog,
    shell,
    MenuItemConstructorOptions,
    nativeImage,
    protocol,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// ─── Security: disable remote module, enable sandbox ───────────────────────
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');

// ─── Single instance lock ───────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Resolve a path inside the extraResources/app-web folder (the Next.js static export). */
function getAppDir(): string {
    if (app.isPackaged) {
        // In packaged build, web files go to Contents/Resources/app-web/
        return path.join(process.resourcesPath, 'app-web');
    }
    // Dev: web app static export is at ../../web/out relative to dist-electron/
    return path.join(__dirname, '../../web/out');
}

let mainWindow: BrowserWindow | null = null;

// ─── Window creation ────────────────────────────────────────────────────────

function createWindow(): void {
    const appDir = getAppDir();

    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: 'PDF Max',
        titleBarStyle: 'hiddenInset', // macOS traffic lights inset into the app
        vibrancy: 'under-window',
        visualEffectState: 'active',
        backgroundColor: '#ffffff',
        show: false, // avoid flash; shown after 'ready-to-show'
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,   // sandbox mode incompatible with PDF.js worker blob URLs
            webSecurity: true,
            allowRunningInsecureContent: false,
        },
    });

    // ── Load the static Next.js export ────────────────────────────────────────
    const indexHtml = path.join(appDir, 'index.html');
    mainWindow.loadFile(indexHtml);

    // Fix relative paths inside the static export when loaded as file://
    // PDF.js uses a CDN worker by default; we override it via the preload.
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
        { urls: ['*://*/*'] },
        (details, callback) => {
            callback({ requestHeaders: { ...details.requestHeaders, Origin: 'null' } });
        }
    );

    // Show window once content is ready (avoids white flash)
    mainWindow.once('ready-to-show', () => {
        mainWindow!.show();
        mainWindow!.focus();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Open external links in the system browser, not Electron
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

// ─── IPC handlers ───────────────────────────────────────────────────────────

/** Dialog: Open a PDF file */
ipcMain.handle('dialog:openFile', async () => {
    const win = mainWindow;
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
        title: 'Open PDF',
        buttonLabel: 'Open',
        filters: [
            { name: 'PDF Documents', extensions: ['pdf'] },
            { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    // Read the file and return as base64 so it can be transferred via IPC
    const buffer = fs.readFileSync(filePath);
    return {
        path: filePath,
        name: path.basename(filePath),
        data: buffer.toString('base64'),
    };
});

/** Dialog: Save an exported PDF */
ipcMain.handle('dialog:saveFile', async (_event, opts: { filename: string; data: string }) => {
    const win = mainWindow;
    if (!win) return false;
    const result = await dialog.showSaveDialog(win, {
        title: 'Export PDF',
        defaultPath: opts.filename || 'annotated.pdf',
        buttonLabel: 'Save',
        filters: [
            { name: 'PDF Documents', extensions: ['pdf'] },
        ],
    });
    if (result.canceled || !result.filePath) return false;
    const buffer = Buffer.from(opts.data, 'base64');
    fs.writeFileSync(result.filePath, buffer);
    return result.filePath;
});

/** Dialog: Show an error box */
ipcMain.handle('dialog:showError', async (_event, { title, message }: { title: string; message: string }) => {
    dialog.showErrorBox(title, message);
});

// ─── Native menu ────────────────────────────────────────────────────────────

function buildMenu(): void {
    const isMac = process.platform === 'darwin';

    const template: MenuItemConstructorOptions[] = [
        // ── App menu (macOS only) ────────────────────────────────────────────
        ...(isMac
            ? [{
                label: app.name,
                submenu: [
                    { role: 'about' as const },
                    { type: 'separator' as const },
                    {
                        label: 'Preferences…',
                        accelerator: 'CmdOrCtrl+,',
                        click: () => {
                            mainWindow?.webContents.send('menu:preferences');
                        },
                    },
                    { type: 'separator' as const },
                    { role: 'services' as const },
                    { type: 'separator' as const },
                    { role: 'hide' as const },
                    { role: 'hideOthers' as const },
                    { role: 'unhide' as const },
                    { type: 'separator' as const },
                    { role: 'quit' as const },
                ] as MenuItemConstructorOptions[],
            }]
            : []),

        // ── File ─────────────────────────────────────────────────────────────
        {
            label: 'File',
            submenu: [
                {
                    label: 'Open PDF…',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => mainWindow?.webContents.send('menu:openFile'),
                },
                { type: 'separator' },
                {
                    label: 'Export PDF…',
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: () => mainWindow?.webContents.send('menu:exportFile'),
                },
                { type: 'separator' },
                {
                    label: 'Print…',
                    accelerator: 'CmdOrCtrl+P',
                    click: () => mainWindow?.webContents.send('menu:print'),
                },
                ...(!isMac ? [{ type: 'separator' as const }, { role: 'quit' as const }] : []),
            ] as MenuItemConstructorOptions[],
        },

        // ── Edit ─────────────────────────────────────────────────────────────
        {
            label: 'Edit',
            submenu: [
                {
                    label: 'Undo',
                    accelerator: 'CmdOrCtrl+Z',
                    click: () => mainWindow?.webContents.send('menu:undo'),
                },
                {
                    label: 'Redo',
                    accelerator: 'CmdOrCtrl+Shift+Z',
                    click: () => mainWindow?.webContents.send('menu:redo'),
                },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
                { type: 'separator' },
                {
                    label: 'Delete Selection',
                    accelerator: 'Backspace',
                    click: () => mainWindow?.webContents.send('menu:deleteSelection'),
                },
            ] as MenuItemConstructorOptions[],
        },

        // ── View ─────────────────────────────────────────────────────────────
        {
            label: 'View',
            submenu: [
                {
                    label: 'Zoom In',
                    accelerator: 'CmdOrCtrl+Plus',
                    click: () => mainWindow?.webContents.send('menu:zoomIn'),
                },
                {
                    label: 'Zoom Out',
                    accelerator: 'CmdOrCtrl+-',
                    click: () => mainWindow?.webContents.send('menu:zoomOut'),
                },
                {
                    label: 'Actual Size',
                    accelerator: 'CmdOrCtrl+0',
                    click: () => mainWindow?.webContents.send('menu:zoomReset'),
                },
                {
                    label: 'Fit to Window',
                    accelerator: 'CmdOrCtrl+Shift+0',
                    click: () => mainWindow?.webContents.send('menu:fitToWindow'),
                },
                { type: 'separator' },
                {
                    label: 'First Page',
                    accelerator: 'CmdOrCtrl+Up',
                    click: () => mainWindow?.webContents.send('menu:firstPage'),
                },
                {
                    label: 'Last Page',
                    accelerator: 'CmdOrCtrl+Down',
                    click: () => mainWindow?.webContents.send('menu:lastPage'),
                },
                { type: 'separator' },
                { role: 'togglefullscreen' },
                { type: 'separator' },
                { role: 'reload' },
                { role: 'toggleDevTools' },
            ] as MenuItemConstructorOptions[],
        },

        // ── Tools ────────────────────────────────────────────────────────────
        {
            label: 'Tools',
            submenu: [
                {
                    label: 'Select / Pan',
                    accelerator: 'V',
                    click: () => mainWindow?.webContents.send('menu:tool', 'select'),
                },
                { type: 'separator' },
                {
                    label: 'Rectangle',
                    accelerator: 'R',
                    click: () => mainWindow?.webContents.send('menu:tool', 'rectangle'),
                },
                {
                    label: 'Text',
                    accelerator: 'T',
                    click: () => mainWindow?.webContents.send('menu:tool', 'text'),
                },
                {
                    label: 'Freehand',
                    accelerator: 'F',
                    click: () => mainWindow?.webContents.send('menu:tool', 'freehand'),
                },
                {
                    label: 'Arrow',
                    accelerator: 'A',
                    click: () => mainWindow?.webContents.send('menu:tool', 'arrow'),
                },
                { type: 'separator' },
                {
                    label: 'Measure Length',
                    accelerator: 'M',
                    click: () => mainWindow?.webContents.send('menu:tool', 'measure-length'),
                },
                {
                    label: 'Measure Area',
                    click: () => mainWindow?.webContents.send('menu:tool', 'measure-area'),
                },
                {
                    label: 'Count',
                    click: () => mainWindow?.webContents.send('menu:tool', 'measure-count'),
                },
            ] as MenuItemConstructorOptions[],
        },

        // ── Window ───────────────────────────────────────────────────────────
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                ...(isMac
                    ? [{ type: 'separator' as const }, { role: 'front' as const }]
                    : [{ role: 'close' as const }]),
            ] as MenuItemConstructorOptions[],
        },

        // ── Help ─────────────────────────────────────────────────────────────
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Keyboard Shortcuts',
                    accelerator: 'CmdOrCtrl+Shift+/',
                    click: () => mainWindow?.webContents.send('menu:keyboardHelp'),
                },
                {
                    label: 'Help Center',
                    click: () => mainWindow?.webContents.send('menu:helpCenter'),
                },
            ] as MenuItemConstructorOptions[],
        },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// ─── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
    buildMenu();
    createWindow();

    app.on('activate', () => {
        // macOS: re-create window when dock icon is clicked and no windows exist
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('second-instance', () => {
    // Focus the existing window if user tries to open a second instance
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

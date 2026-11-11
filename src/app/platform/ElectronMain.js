const electron = require('electron');
const {app, BrowserWindow,Menu} = electron;
const path = require('path');
const PlatformMqttClientService = require('./PlatformMqttClientService');
const PlatformMqttLoadService = require('./PlatformMqttLoadService');
let win;
const template = [
    {
        label: 'MQTTBox',
        submenu: [
            {
                label: 'About MQTTBox',
                click () { require('electron').shell.openExternal('https://github.com/workswithweb/MQTTBox') }
            },
            {
                label: 'Quit MQTTBox',
                accelerator: 'CmdOrCtrl+Q',
                click: function () {
                    PlatformMqttClientService.default.killChildProcess();
                    PlatformMqttLoadService.default.killChildProcess();
                    app.quit();
                }
            }
        ]
    },
    {
        label: 'Edit',
        submenu: [
            { label: "Undo", accelerator: "CmdOrCtrl+Z", role: "undo" },
            { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", role: "redo" },
            { type: "separator" },
            { label: "Cut", accelerator: "CmdOrCtrl+X", role: "cut" },
            { label: "Copy", accelerator: "CmdOrCtrl+C", role: "copy" },
            { label: "Paste", accelerator: "CmdOrCtrl+V", role: "paste" },
            { label: "Select All", accelerator: "CmdOrCtrl+A", role: "selectAll" }
        ]
    },
    {
        label: 'Help',
        submenu: [
            {
                label: 'Documentation',
                click () { require('electron').shell.openExternal('https://github.com/Andy1001Yu/MQTTBox#readme') }
            },
            {
                label: 'Download Apps',
                click () { require('electron').shell.openExternal('https://github.com/Andy1001Yu/MQTTBox/releases') }
            }
        ]
    }
];

function createWindow () {
    const {width, height} = electron.screen.getPrimaryDisplay().workAreaSize;
    win = new BrowserWindow({width, height, webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false
    }});
    win.loadFile(path.join(__dirname, '..', 'index.html'));
    // The legacy renderer has Node access; keep navigation within the app.
    win.webContents.on('will-navigate', function(event, url) {
        if(url !== win.webContents.getURL()) event.preventDefault();
    });
    win.webContents.setWindowOpenHandler(function() { return {action: 'deny'}; });
    //win.webContents.openDevTools();
    win.on('closed', () => {
        win = null
    });
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

app.on('ready', createWindow);

app.on('before-quit', () => {
    PlatformMqttClientService.default.killChildProcess();
    PlatformMqttLoadService.default.killChildProcess();
});

app.on('window-all-closed', () => {
    PlatformMqttClientService.default.killChildProcess();
    PlatformMqttLoadService.default.killChildProcess();
    app.quit();
});

app.on('activate', () => {
    if (win === null) {
        createWindow()
    }
});


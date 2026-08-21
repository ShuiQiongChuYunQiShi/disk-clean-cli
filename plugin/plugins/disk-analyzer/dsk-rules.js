// lib/rules.js — 规则单源（桌面引擎与插件引擎共用）
// 本文件是唯一来源；修改规则只需改这里，运行 scripts/sync-rules.ps1 同步到插件侧。
'use strict';

const DAYS = 24 * 3600 * 1000;

// 默认阈值（可在 run() 时被配置文件覆盖）
const DEFAULTS = {
  STALE_MS: 730 * DAYS,                 // 陈旧阈值：修改时间超过 730 天
  STALE_LARGE_MIN: 500 * 1024 * 1024,   // 陈旧大文件阈值：≥ 500MB
  DUP_MIN_SIZE: 1 << 20,                // 重复候选最小字节：1MB
  LOOSE_MS: 30 * DAYS,                  // 散落判定：目录修改时间 > 30 天
  LOOSE_MIN: 100 * 1024 * 1024,         // 散落判定：目录大小 ≥ 100MB
};

const DUP_FULL_LIMIT = 32 * 1024 * 1024;  // 全哈希确认上限
const DUP_HEAD = 64 * 1024;               // head 哈希长度（阶段 1）
const DUP_TAIL = 64 * 1024;               // tail 哈希长度（阶段 2，仅 head 命中后读取）
const WIDE_MAX_FILES = 20000;
const WIDE_MAX_BYTES = 1024 * 1024 * 1024; // 扩展候选单文件上限 1GB
const LOOSE_MAX = 100;                     // 报告 organizeCandidates 上限
const MAX_DEPTH = 64;
const CONCURRENCY = 64;

// 扩展名 → 类别
const EXT_CAT = {
  mp4:'媒体',mkv:'媒体',mov:'媒体',avi:'媒体',wmv:'媒体',flv:'媒体',webm:'媒体',m4v:'媒体',ts:'媒体',
  mp3:'媒体',flac:'媒体',wav:'媒体',aac:'媒体',ogg:'媒体',m4a:'媒体',wma:'媒体',opus:'媒体',mid:'媒体',
  jpg:'图片',jpeg:'图片',png:'图片',gif:'图片',webp:'图片',bmp:'图片',svg:'图片',ico:'图片',tif:'图片',tiff:'图片',raw:'图片',heic:'图片',psd:'图片',ai:'图片',avif:'图片',
  doc:'文档',docx:'文档',xls:'文档',xlsx:'文档',ppt:'文档',pptx:'文档',pdf:'文档',txt:'文档',md:'文档',rtf:'文档',csv:'文档',epub:'文档',pages:'文档',numbers:'文档',key:'文档',
  zip:'压缩包',rar:'压缩包','7z':'压缩包',tar:'压缩包',gz:'压缩包',bz2:'压缩包',xz:'压缩包',iso:'压缩包',cab:'压缩包',zst:'压缩包',
  exe:'安装包',msi:'安装包',msix:'安装包',appx:'安装包',dmg:'安装包',
  js:'代码',ts:'代码',jsx:'代码',tsx:'代码',py:'代码',java:'代码',c:'代码',h:'代码',cpp:'代码',cc:'代码',hpp:'代码',cs:'代码',go:'代码',rs:'代码',rb:'代码',php:'代码',swift:'代码',kt:'代码',scala:'代码',sh:'代码',bat:'代码',ps1:'代码',sql:'代码',html:'代码',css:'代码',vue:'代码',json:'代码',xml:'代码',yaml:'代码',yml:'代码',toml:'代码',ini:'代码',cfg:'代码',
  log:'日志',tmp:'临时',temp:'临时',bak:'备份',
  dll:'系统',sys:'系统',drv:'系统',mui:'系统',cat:'系统',ocx:'系统',
  db:'数据库',sqlite:'数据库',sqlite3:'数据库',mdf:'数据库',ldf:'数据库',accdb:'数据库',mdb:'数据库',
  vhd:'虚拟磁盘',vhdx:'虚拟磁盘',vmdk:'虚拟磁盘',vdi:'虚拟磁盘',
  node_modules:'依赖包',jar:'依赖包',whl:'依赖包',gem:'依赖包',nupkg:'依赖包'
};

const EXT_JUNK = { dmp:'崩溃转储', mdmp:'崩溃转储', tmp:'临时文件', temp:'临时文件' };

const DIR_CAT_RULES = [
  { segs:['windows'], cat:'系统目录' },
  { segs:['windows.old'], cat:'旧系统' },
  { segs:['program files','program files (x86)'], cat:'程序目录' },
  { segs:['programdata'], cat:'应用数据' },
  { segs:['appdata'], cat:'应用数据' },
  { segs:['users'], cat:'用户数据' },
  { segs:['documents','downloads','desktop','pictures','videos','music','onedrive'], cat:'用户数据' },
  { segs:['node_modules','.git','dist','build','target','__pycache__','venv','.venv','.gradle','.idea','.vscode'], cat:'开发工程' },
  { segs:['temp','tmp','cache','caches'], cat:'临时/缓存' },
  { segs:['$recycle.bin'], cat:'回收站' }
];

const JUNK_RULES = [
  { label:'回收站', match:s => s.indexOf('$recycle.bin') >= 0 },
  { label:'用户临时目录', match:s => s.indexOf('appdata') >= 0 && s.indexOf('temp') >= 0 },
  { label:'Windows 临时', match:s => s.indexOf('windows') >= 0 && s.indexOf('temp') >= 0 },
  { label:'Windows 预读取', match:s => s.indexOf('windows') >= 0 && s.indexOf('prefetch') >= 0 },
  { label:'Windows 更新缓存', match:s => s.indexOf('windows') >= 0 && s.indexOf('softwaredistribution') >= 0 && s.indexOf('download') >= 0 },
  { label:'浏览器缓存', match:s => (s.indexOf('chrome') >= 0 || s.indexOf('msedge') >= 0 || s.indexOf('microsoft edge') >= 0 || s.indexOf('firefox') >= 0 || s.indexOf('chromium') >= 0) && (s.indexOf('cache') >= 0 || s.indexOf('cacheddata') >= 0 || s.indexOf('code cache') >= 0 || s.indexOf('gpucache') >= 0) },
  { label:'缩略图缓存', match:s => s.indexOf('explorer') >= 0 && (s.indexOf('thumbcache') >= 0 || s.indexOf('thumbnails') >= 0 || s.indexOf('iconcache') >= 0) },
  { label:'Windows.old', match:s => s.indexOf('windows.old') >= 0 }
];

const AUTO_SKIP = ['system volume information'];

const USER_ZONE_SEGS = ['downloads', 'documents', 'desktop', 'pictures', 'videos', 'music', 'onedrive'];

const APP_ZONE_SEGS = [
  'steamapps', 'wegameapps', 'rail_apps', 'epic games', 'gog games', 'gog galaxy',
  'battle.net', 'origin games', 'xboxgames', 'ubisoft game launcher', 'blizzard', 'ubisoft'
];

const DRIVE_ROOT_SKIP = [
  'windows', 'program files', 'program files (x86)', 'programdata', 'users',
  '$recycle.bin', 'system volume information', 'recovery', 'perflogs',
  'intel', 'msocache', 'config.msi', 'onekey', 'oneclick', 'dsh', '.dsh',
  '整理区', 'temp', 'tmp'
];

const PROG_NAME_HINTS = [
  'steam', 'wegame', 'epic', 'gog', 'battle.net', 'origin', 'xbox', 'ubisoft', 'blizzard', 'razer', 'logitech',
  'qq', 'wechat', 'weixin', '微信', 'tim', '钉钉', 'dingtalk', 'alipay', '支付宝', 'wps', 'office', 'vs code', 'vscode',
  'visual studio', 'jetbrains', 'idea', 'pycharm', 'goland', 'webstorm', 'android', 'sdk', 'ndk', 'nodejs', 'node',
  'python', 'anaconda', 'miniconda', 'rust', 'cargo', 'golang', 'unity', 'unreal', 'ue4', 'ue5', 'blender', 'photoshop', 'adobe',
  'autocad', 'cad', 'chrome', 'firefox', 'edge', '360', 'tencent', 'baidu', 'alibaba', 'netease', 'youdao', 'obs', 'bandizip',
  'winrar', '7-zip', '7zip', 'vmware', 'virtualbox', 'docker', 'wsl', 'git', 'svn', 'maven', 'gradle', 'npm', 'yarn', 'pnpm',
  'mysql', 'postgresql', 'oracle', 'mongodb', 'redis', 'nginx', 'tomcat', 'java', 'jdk', 'jre', 'dotnet', 'vcredist', 'directx',
  'vulkan', 'cuda', 'nvidia', 'amd', 'driver', '驱动', '游戏', 'games', 'game', 'lol', '英雄联盟', 'dota', 'csgo', 'cs2', 'valorant',
  'genshin', '原神', 'mihoyo', 'miyoho', 'star rail', '崩坏', 'apex', 'pubg', '绝地求生', 'minecraft', '我的世界'
];

const PROG_DIR_HINTS = ['steamapps', 'wegameapps', 'rail_apps', 'bin', 'exe', 'release', 'debug'];

const PROG_EXT = { exe: 1, dll: 1, msi: 1, msix: 1, appx: 1, sys: 1, bat: 1, cmd: 1 };

const ORG_CAT_MAP = { '媒体': '媒体', '图片': '图片', '文档': '文档', '安装包': '安装包', '压缩包': '压缩包', '虚拟磁盘': '虚拟磁盘', '数据库': '数据库', '备份': '备份' };

module.exports = {
  DAYS, DEFAULTS,
  DUP_FULL_LIMIT, DUP_HEAD, DUP_TAIL, WIDE_MAX_FILES, WIDE_MAX_BYTES, LOOSE_MAX, MAX_DEPTH, CONCURRENCY,
  EXT_CAT, EXT_JUNK, DIR_CAT_RULES, JUNK_RULES, AUTO_SKIP,
  USER_ZONE_SEGS, APP_ZONE_SEGS, DRIVE_ROOT_SKIP,
  PROG_NAME_HINTS, PROG_DIR_HINTS, PROG_EXT, ORG_CAT_MAP,
};

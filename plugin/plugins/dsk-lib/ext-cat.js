// ext-cat.js — 扩展名分类表（从 CLI lib/engine.js 提取，供 mftscan 复用）
'use strict';
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
module.exports = { EXT_CAT };

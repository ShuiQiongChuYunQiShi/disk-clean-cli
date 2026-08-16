# scripts/make-icon.ps1 - generate disk-clean app icon (dark rounded tile + disk ring + green bolt)
# Output: gui/shell/app.ico (16/24/32/48/64/128/256 PNG-in-ICO) and gui/shell/icon-256.png (preview)
# Notes for PS 5.1:
#   * New-Object constructor binding is flaky in this environment; use ::new() everywhere.
#   * Keep this file pure ASCII so ANSI vs UTF-8 mis-detection cannot mangle statements.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent $PSScriptRoot
$ShellDir = Join-Path $Root 'gui\shell'
New-Item -ItemType Directory -Force -Path $ShellDir | Out-Null

function New-RoundedPath([int]$size, [int]$r) {
  $p = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $p.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
  $p.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
  $p.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90)
  $p.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
  $p.CloseFigure()
  return $p
}

function Draw-Master([int]$size) {
  $bmp = [System.Drawing.Bitmap]::new($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $f = [float]$size / 256.0

  # Background: vertical-gradient rounded tile
  $rectAll = [System.Drawing.Rectangle]::new(0, 0, $size, $size)
  $cTop = [System.Drawing.Color]::FromArgb(255, 29, 44, 71)
  $cBot = [System.Drawing.Color]::FromArgb(255, 16, 20, 29)
  $bg = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rectAll, $cTop, $cBot, [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
  Write-Host ("step bg: " + ($bg -ne $null))
  $bgPath = New-RoundedPath $size ([int](52 * $f))
  $g.FillPath($bg, $bgPath)
  $g.DrawPath([System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(45, 255, 255, 255), [float](1.5 * $f)), $bgPath)
  $bg.Dispose()

  # Disk: ring + inner plate (diagonal gradient) + spindle
  $ring = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 82, 102, 140), [float](11 * $f))
  $g.DrawEllipse($ring, [float](34 * $f), [float](58 * $f), [float](152 * $f), [float](152 * $f))
  $goldRect = [System.Drawing.RectangleF]::new([float](42 * $f), [float](66 * $f), [float](136 * $f), [float](136 * $f))
  $gold = [System.Drawing.Drawing2D.LinearGradientBrush]::new($goldRect, [System.Drawing.Color]::FromArgb(255, 43, 58, 88), [System.Drawing.Color]::FromArgb(255, 30, 40, 62), [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
  Write-Host ("step gold: " + ($gold -ne $null))
  $g.FillEllipse($gold, [float](42 * $f), [float](66 * $f), [float](136 * $f), [float](136 * $f))
  $gold.Dispose()
  $spindle = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 25, 34, 55))
  $g.FillEllipse($spindle, [float](100 * $f), [float](124 * $f), [float](28 * $f), [float](28 * $f))
  $spindle.Dispose()

  # Bolt (green + darker outline for small-size definition)
  $bolt = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $pts = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new([float](206 * $f), [float](58 * $f)),
    [System.Drawing.PointF]::new([float](104 * $f), [float](144 * $f)),
    [System.Drawing.PointF]::new([float](140 * $f), [float](144 * $f)),
    [System.Drawing.PointF]::new([float](116 * $f), [float](198 * $f)),
    [System.Drawing.PointF]::new([float](222 * $f), [float](126 * $f)),
    [System.Drawing.PointF]::new([float](182 * $f), [float](126 * $f)),
    [System.Drawing.PointF]::new([float](206 * $f), [float](58 * $f))
  )
  $bolt.AddPolygon($pts)
  Write-Host ("step bolt: " + ($bolt -ne $null))
  $boltFill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 61, 220, 132))
  $g.FillPath($boltFill, $bolt)
  $boltFill.Dispose()
  $g.DrawPath([System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 10, 96, 54), [float](3 * $f)), $bolt)

  $g.Dispose()
  return $bmp
}

# Master + preview PNG
$master = Draw-Master 256
$master.Save((Join-Path $ShellDir 'icon-256.png'), [System.Drawing.Imaging.ImageFormat]::Png)

# Per-size PNG bytes
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngs = @()
$i = 0
while ($i -lt $sizes.Count) {
  $s = $sizes[$i]
  $small = [System.Drawing.Bitmap]::new($s, $s)
  $sg = [System.Drawing.Graphics]::FromImage($small)
  $sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $sg.Clear([System.Drawing.Color]::Transparent)
  $sg.DrawImage($master, 0, 0, $s, $s)
  $sg.Dispose()
  $ms = [System.IO.MemoryStream]::new()
  $small.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += , @{ size = $s; bytes = $ms.ToArray() }
  $small.Dispose()
  $ms.Dispose()
  $i++
}
$master.Dispose()

# Pack PNG-in-ICO (Vista+ supports PNG entries; Win10/11 fine for all sizes)
function Write-IcoFile($pngs, $path) {
  $count = $pngs.Count
  $headLen = 6 + 16 * $count
  $header = New-Object byte[] $headLen
  [System.BitConverter]::GetBytes([uint16]0).CopyTo($header, 0)
  [System.BitConverter]::GetBytes([uint16]1).CopyTo($header, 2)
  [System.BitConverter]::GetBytes([uint16]$count).CopyTo($header, 4)
  $offset = $headLen
  $pos = 6
  foreach ($p in $pngs) {
    $b = $p.bytes
    if ($p.size -ge 256) { $header[$pos] = 0 } else { $header[$pos] = [byte]$p.size }
    $header[$pos + 1] = 0; $header[$pos + 2] = 0; $header[$pos + 3] = 0
    [System.BitConverter]::GetBytes([uint16]1).CopyTo($header, $pos + 4)
    [System.BitConverter]::GetBytes([uint16]32).CopyTo($header, $pos + 6)
    [System.BitConverter]::GetBytes([uint32]$b.Length).CopyTo($header, $pos + 8)
    [System.BitConverter]::GetBytes([uint32]$offset).CopyTo($header, $pos + 12)
    $pos += 16
    $offset += $b.Length
  }
  $fs = [System.IO.File]::Create($path)
  $fs.Write($header, 0, $header.Length)
  foreach ($p in $pngs) { $fs.Write($p.bytes, 0, $p.bytes.Length) }
  $fs.Close()
}
$icoPath = Join-Path $ShellDir 'app.ico'
Write-IcoFile $pngs $icoPath
Write-Output ("icon written: {0} ({1} bytes, {2} sizes)" -f $icoPath, (Get-Item $icoPath).Length, $pngs.Count)
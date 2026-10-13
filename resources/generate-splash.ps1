# -*- coding: utf-8 -*-
# يولد صورة الافتتاحية (Splash) 2732x2732: الأيقونة في الوسط واسم التطبيق "المهندس" تحتها.
# يستخدم WPF (DirectWrite) لتصيير النص العربي بشكل سليم (تشكيل + اتجاه RTL)، ثم GDI+ للتركيب.
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$W = 2732
$H = 2732

# كلمة "المهندس" مبنية برموز يونيكود لتفادي أي مشكلة ترميز في الملف
$text = [string]([char]0x0627 + [char]0x0644 + [char]0x0645 + [char]0x0647 + [char]0x0646 + [char]0x062F + [char]0x0633)

# ===== 1) تصيير النص العربي عبر WPF (يعالج التشكيل والاتجاه بشكل صحيح) =====
$textW = 1300
$textH = 480
$rtb = New-Object System.Windows.Media.Imaging.RenderTargetBitmap($textW, $textH, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
$dv = New-Object System.Windows.Media.DrawingVisual
$dc = $dv.RenderOpen()

$color = [System.Windows.Media.Color]::FromRgb(0x38, 0xBD, 0xF8)
$brush = New-Object System.Windows.Media.SolidColorBrush($color)
$culture = [System.Globalization.CultureInfo]::GetCultureInfo('ar-SA')
$ff = New-Object System.Windows.Media.FontFamily('Segoe UI')
$typeface = New-Object System.Windows.Media.Typeface($ff, [System.Windows.FontStyles]::Normal, [System.Windows.FontWeights]::Bold, [System.Windows.FontStretches]::Normal)
$ft = New-Object System.Windows.Media.FormattedText($text, $culture, [System.Windows.FlowDirection]::RightToLeft, $typeface, 300, $brush)

$txPix = [int](([math]::Max($textW, $ft.Width) - $ft.Width) / 2)
$tyPix = [int](($textH - $ft.Height) / 2)
$dc.DrawText($ft, (New-Object System.Windows.Point($txPix, $tyPix)))
$dc.Close()
$rtb.Render($dv)

$textPath = Join-Path $dir 'splash-text.png'
$enc = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
$enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($rtb))
$fs = [System.IO.File]::Open($textPath, [System.IO.FileMode]::Create)
$enc.Save($fs)
$fs.Close()

# ===== 2) تركيب الخلفية + الأيقونة + النص عبر GDI+ =====
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

# خلفية داكنة تناسب تصميم الأيقونة
$bg = [System.Drawing.ColorTranslator]::FromHtml('#0A1929')
$g.Clear($bg)

# ---- رسم الأيقونة في الوسط (الجزء العلوي) ----
$icon = New-Object System.Drawing.Bitmap((Join-Path $dir 'icon.png'))
$iconSize = 1150
$ix = [int](($W - $iconSize) / 2)
$iy = 430
$g.DrawImage($icon, $ix, $iy, $iconSize, $iconSize)
$icon.Dispose()

# ---- لصق النص العربي تحتها (بمقاسه الأصلي 1:1 للحفاظ على الحدّة) ----
$textImg = New-Object System.Drawing.Bitmap($textPath)
$textX = [int](($W - $textW) / 2)
$textY = 1820
$g.DrawImage($textImg, $textX, $textY, $textW, $textH)
$textImg.Dispose()

$out = Join-Path $dir 'splash.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

Remove-Item $textPath -ErrorAction SilentlyContinue

$chk = New-Object System.Drawing.Bitmap($out)
Write-Output ("Splash created: {0}x{1} at {2}" -f $chk.Width, $chk.Height, $out)
$chk.Dispose()

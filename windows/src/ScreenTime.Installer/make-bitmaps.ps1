# Draws the installer's two pictures (UI.wxs): dialog.bmp (493 x 312, the left band of Welcome and the finish pages)
# and banner.bmp (493 x 58, the top of the other pages). The tray's hourglass, white on the app's teal (#0F766E).
# Run with Windows PowerShell 5.1 (it has System.Drawing): powershell -File make-bitmaps.ps1
Add-Type -AssemblyName System.Drawing
$teal = [Drawing.Color]::FromArgb(15, 118, 110)

function Hourglass($g, [double]$x, [double]$y, [double]$s, $color) {
    $fill = New-Object Drawing.SolidBrush $color
    $sand = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(170, $color))
    $pen = New-Object Drawing.Pen $color, ([single]($s / 14))
    $bar = $s / 11
    $x0 = $x + 0.12 * $s; $x1 = $x + 0.88 * $s; $mid = ($x0 + $x1) / 2
    $g.FillRectangle($fill, [single]($x0 - $s * 0.03), [single]($y + 0.06 * $s), [single]($x1 - $x0 + $s * 0.06), [single]$bar)
    $g.FillRectangle($fill, [single]($x0 - $s * 0.03), [single]($y + 0.94 * $s - $bar), [single]($x1 - $x0 + $s * 0.06), [single]$bar)
    $top = $y + 0.06 * $s + $bar; $bottom = $y + 0.94 * $s - $bar; $waist = ($top + $bottom) / 2
    $g.DrawLines($pen, [Drawing.PointF[]]@(
        (New-Object Drawing.PointF ([single]($x0 + $s * 0.04)), ([single]$top)),
        (New-Object Drawing.PointF ([single]($mid - $s * 0.03)), ([single]$waist)),
        (New-Object Drawing.PointF ([single]($x0 + $s * 0.04)), ([single]$bottom))))
    $g.DrawLines($pen, [Drawing.PointF[]]@(
        (New-Object Drawing.PointF ([single]($x1 - $s * 0.04)), ([single]$top)),
        (New-Object Drawing.PointF ([single]($mid + $s * 0.03)), ([single]$waist)),
        (New-Object Drawing.PointF ([single]($x1 - $s * 0.04)), ([single]$bottom))))
    # Sand: a little left on top, a heap at the bottom.
    $g.FillPolygon($sand, [Drawing.PointF[]]@(
        (New-Object Drawing.PointF ([single]($mid - $s * 0.16)), ([single]($top + ($waist - $top) * 0.55))),
        (New-Object Drawing.PointF ([single]($mid + $s * 0.16)), ([single]($top + ($waist - $top) * 0.55))),
        (New-Object Drawing.PointF ([single]$mid), ([single]($waist - $s * 0.02)))))
    $g.FillPolygon($sand, [Drawing.PointF[]]@(
        (New-Object Drawing.PointF ([single]($x0 + $s * 0.12)), ([single]($bottom - $s * 0.02))),
        (New-Object Drawing.PointF ([single]($x1 - $s * 0.12)), ([single]($bottom - $s * 0.02))),
        (New-Object Drawing.PointF ([single]$mid), ([single]($bottom - $s * 0.2)))))
}

function Save($bmp, $name) {
    $bmp.Save((Join-Path $PSScriptRoot $name), [Drawing.Imaging.ImageFormat]::Bmp)
    $bmp.Dispose()
}

# The dialog picture: WiX puts the page's words from x = 164 (in 493 px), so the band is 164 px wide.
$bmp = New-Object Drawing.Bitmap 493, 312, ([Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([Drawing.Color]::White)
$g.FillRectangle((New-Object Drawing.SolidBrush $teal), 0, 0, 164, 312)
Hourglass $g 42 40 80 ([Drawing.Color]::White)
$g.Dispose()
Save $bmp "dialog.bmp"

# The banner: white, with a small teal hourglass on the right.
$bmp = New-Object Drawing.Bitmap 493, 58, ([Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([Drawing.Color]::White)
Hourglass $g 440 9 40 $teal
$g.Dispose()
Save $bmp "banner.bmp"

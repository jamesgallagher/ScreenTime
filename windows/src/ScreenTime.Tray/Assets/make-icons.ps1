# Draws the tray icons (docs/SPEC.md §16.3): an hourglass with a coloured dot, for a dark and a light taskbar.
# Run with Windows PowerShell 5.1 (it has System.Drawing): powershell -File make-icons.ps1
# Writes tray-<theme>-<level>.ico next to this script. Each .ico holds 32-bit frames at 16 to 64 px.
Add-Type -AssemblyName System.Drawing

$sizes = 16, 20, 24, 32, 40, 48, 64
$themes = @{ dark = 'FFFFFF'; light = '1C1917' }   # glyph colour on a dark / light taskbar
$dots = @{                                         # §16.1 tokens: primary, warning, critical, muted
    dark  = @{ plenty = '2DD4BF'; low = 'FBBF24'; critical = 'FB923C'; offline = 'A8A29E' }
    light = @{ plenty = '0F766E'; low = 'D97706'; critical = 'EA580C'; offline = '57534E' }
}

function Color($hex, $alpha = 255) {
    [Drawing.Color]::FromArgb($alpha, [Convert]::ToInt32($hex.Substring(0, 2), 16), [Convert]::ToInt32($hex.Substring(2, 2), 16), [Convert]::ToInt32($hex.Substring(4, 2), 16))
}

function Frame($size, $glyph, $dot) {
    $bmp = New-Object Drawing.Bitmap $size, $size, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([Drawing.Color]::Transparent)
    $s = [double]$size
    $x0 = 0.12 * $s; $x1 = 0.74 * $s; $mid = ($x0 + $x1) / 2
    $pen = New-Object Drawing.Pen (Color $glyph), ([Math]::Max(1.0, $s / 14))
    $fill = New-Object Drawing.SolidBrush (Color $glyph)
    $sand = New-Object Drawing.SolidBrush (Color $glyph 170)
    $bar = [Math]::Max(1.5, $s / 11)
    # Top and bottom bars.
    $g.FillRectangle($fill, [single]($x0 - $s * 0.02), [single](0.08 * $s), [single]($x1 - $x0 + $s * 0.04), [single]$bar)
    $g.FillRectangle($fill, [single]($x0 - $s * 0.02), [single](0.92 * $s - $bar), [single]($x1 - $x0 + $s * 0.04), [single]$bar)
    # The glass: two triangles meeting in the middle.
    $top = 0.08 * $s + $bar; $bottom = 0.92 * $s - $bar; $neck = 0.5 * $s
    $inset = 0.06 * $s
    $glass = [Drawing.PointF[]]@(
        (New-Object Drawing.PointF ([single]($x0 + $inset)), ([single]$top)),
        (New-Object Drawing.PointF ([single]($x1 - $inset)), ([single]$top)),
        (New-Object Drawing.PointF ([single]($mid + $s * 0.04)), ([single]$neck)),
        (New-Object Drawing.PointF ([single]($x1 - $inset)), ([single]$bottom)),
        (New-Object Drawing.PointF ([single]($x0 + $inset)), ([single]$bottom)),
        (New-Object Drawing.PointF ([single]($mid - $s * 0.04)), ([single]$neck)))
    $g.DrawPolygon($pen, $glass)
    # Sand in the bottom half.
    $sandTop = $neck + ($bottom - $neck) * 0.45
    $w = ($x1 - $x0 - 2 * $inset) * 0.45 * 0.9
    $pile = [Drawing.PointF[]]@(
        (New-Object Drawing.PointF ([single]($mid - $w)), ([single]$sandTop)),
        (New-Object Drawing.PointF ([single]($mid + $w)), ([single]$sandTop)),
        (New-Object Drawing.PointF ([single]($x1 - $inset)), ([single]$bottom)),
        (New-Object Drawing.PointF ([single]($x0 + $inset)), ([single]$bottom)))
    $g.FillPolygon($sand, $pile)
    # The dot, bottom right, with a clear ring so it stands off the glyph.
    $r = 0.21 * $s; $ring = [Math]::Max(1.0, 0.07 * $s); $cx = 0.77 * $s; $cy = 0.77 * $s
    $g.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
    $clear = New-Object Drawing.SolidBrush ([Drawing.Color]::Transparent)
    $g.FillEllipse($clear, [single]($cx - $r - $ring), [single]($cy - $r - $ring), [single](2 * ($r + $ring)), [single](2 * ($r + $ring)))
    $g.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceOver
    $g.FillEllipse((New-Object Drawing.SolidBrush (Color $dot)), [single]($cx - $r), [single]($cy - $r), [single](2 * $r), [single](2 * $r))
    $g.Dispose()
    # A 32-bit DIB frame (BITMAPINFOHEADER, bottom-up BGRA, then an all-zero AND mask): every Windows API reads it.
    $data = $bmp.LockBits((New-Object Drawing.Rectangle 0, 0, $size, $size), [Drawing.Imaging.ImageLockMode]::ReadOnly, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $pixels = New-Object byte[] ($size * $size * 4)
    [Runtime.InteropServices.Marshal]::Copy($data.Scan0, $pixels, 0, $pixels.Length)
    $bmp.UnlockBits($data)
    $bmp.Dispose()
    $maskRow = [int]([Math]::Ceiling($size / 32.0) * 4)
    $ms = New-Object IO.MemoryStream
    $w = New-Object IO.BinaryWriter $ms
    $w.Write([uint32]40); $w.Write([int32]$size); $w.Write([int32]($size * 2)); $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]0); $w.Write([uint32]($pixels.Length + $maskRow * $size)); $w.Write([int32]0); $w.Write([int32]0); $w.Write([uint32]0); $w.Write([uint32]0)
    for ($y = $size - 1; $y -ge 0; $y--) { $w.Write($pixels, $y * $size * 4, $size * 4) }
    $w.Write((New-Object byte[] ($maskRow * $size)))
    $w.Flush()
    , $ms.ToArray()
}

foreach ($theme in $themes.Keys) {
    foreach ($level in $dots[$theme].Keys) {
        $images = foreach ($size in $sizes) { , (Frame $size $themes[$theme] $dots[$theme][$level]) }
        $out = New-Object IO.MemoryStream
        $w = New-Object IO.BinaryWriter $out
        $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
        $offset = 6 + 16 * $sizes.Count
        for ($i = 0; $i -lt $sizes.Count; $i++) {
            $size = $sizes[$i]
            $w.Write([byte]($size % 256)); $w.Write([byte]($size % 256)); $w.Write([byte]0); $w.Write([byte]0)
            $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$images[$i].Length); $w.Write([uint32]$offset)
            $offset += $images[$i].Length
        }
        foreach ($img in $images) { $w.Write($img) }
        $w.Flush()
        [IO.File]::WriteAllBytes((Join-Path $PSScriptRoot "tray-$theme-$level.ico"), $out.ToArray())
    }
}
"wrote $((Get-ChildItem (Join-Path $PSScriptRoot '*.ico')).Count) icons"

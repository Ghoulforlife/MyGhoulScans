$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Admin\Documents\Default Project\Website\site'
$idxPath = Join-Path $root 'index.html'
$appPath = Join-Path $root 'public\app.js'
$cssPath = Join-Path $root 'public\styles.css'

# Always read/write UTF-8 explicitly — Windows PowerShell's default ANSI
# decoding double-encodes non-ASCII characters (arrows, flags, accents).
$utf8 = New-Object Text.UTF8Encoding($false)
$html = [IO.File]::ReadAllText($idxPath, $utf8)
$app  = [IO.File]::ReadAllText($appPath, $utf8)
$css  = [IO.File]::ReadAllText($cssPath, $utf8)

function Cut([string]$text, [string]$start, [string]$end) {
  $i = $text.IndexOf($start)
  if ($i -lt 0) { throw "start not found: $start" }
  $j = $text.IndexOf($end, $i)
  if ($j -lt 0) { throw "end not found: $end" }
  return $text.Substring($i, $j - $i)
}

# 1. New chapterListHtml function
$newFn = Cut $app 'function chapterListHtml(chapters, progress, counts, manga) {' '// Numeric chapter number'
$oldFn = Cut $html 'function chapterListHtml(chapters, progress, counts) {' '// Numeric chapter number'
$html = $html.Replace($oldFn, $newFn)

# 2. Pass manga through
$html = $html.Replace('chapterListHtml(chapters, progress, readCounts)', 'chapterListHtml(chapters, progress, readCounts, manga)')

# 3. New sort/filter handlers (replaces the old expand handler)
$newHandlers = Cut $app "    // Chapter table: sortable columns, goto filter, and result count." "    view.querySelectorAll('.row-ctrl')"
$oldHandlers = Cut $html "    `$('#chapterExpand')?.addEventListener('click', () => {" "    view.querySelectorAll('.row-ctrl')"
$html = $html.Replace($oldHandlers, $newHandlers)

# 5. Keep a single recommendation carousel ("More like this"); remove the
#    duplicate "Recommended by readers" section.
$recSect = '<div class="sect" id="recSect">'
$i = $html.IndexOf($recSect)
if ($i -ge 0) {
  # Walk div tags so the whole section is removed, including its closing tag.
  $depth = 0
  $p = $i
  $end = -1
  while ($p -lt $html.Length) {
    $open = $html.IndexOf('<div', $p)
    $close = $html.IndexOf('</div>', $p)
    if ($close -lt 0) { break }
    if ($open -ge 0 -and $open -lt $close) { $depth++; $p = $open + 4; continue }
    $depth--
    $p = $close + 6
    if ($depth -eq 0) { $end = $p; break }
  }
  if ($end -gt 0) { $html = $html.Substring(0, $i) + $html.Substring($end) }
}

# 6. New CSS
$newCss = Cut $css '/* Chapter table (matches the app' '.chapter-list { display: flex;'
$html = $html.Replace('.chapter-list { display: flex;', $newCss + '.chapter-list { display: flex;')

[IO.File]::WriteAllText($idxPath, $html, $utf8)
Write-Output "patched index.html: $($html.Length) chars; has ctSortChap=$($html.Contains('ctSortChap')); mojibake=$($html.Contains('Ã¢'))"

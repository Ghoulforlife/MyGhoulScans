$ErrorActionPreference = 'Stop'
$root = 'C:\Users\Admin\Documents\Default Project\Website\site'
$idxPath = Join-Path $root 'index.html'
$appPath = Join-Path $root 'public\app.js'
$cssPath = Join-Path $root 'public\styles.css'

$html = Get-Content $idxPath -Raw
$app = Get-Content $appPath -Raw
$css = Get-Content $cssPath -Raw

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

# 4. New CSS
$newCss = Cut $css '/* Chapter table (matches the app' '.chapter-list { display: flex;'
$html = $html.Replace('.chapter-list { display: flex;', $newCss + '.chapter-list { display: flex;')

[IO.File]::WriteAllText($idxPath, $html, (New-Object Text.UTF8Encoding($false)))
Write-Output "patched index.html: $($html.Length) chars; has ctSortChap=$($html.Contains('ctSortChap'))"

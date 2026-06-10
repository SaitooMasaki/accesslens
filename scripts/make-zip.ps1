Add-Type -AssemblyName System.IO.Compression.FileSystem

$src = 'C:\Users\kam1n\accesslens'
$out = 'C:\Users\kam1n\accesslens-store.zip'

$includes = @(
  'manifest.json', 'background.js',
  '_locales', 'assets', 'content', 'lib',
  'licensing', 'options', 'panel', 'popup',
  'pricing', 'report', 'storage'
)

if (Test-Path $out) { Remove-Item $out -Force }

$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')

foreach ($item in $includes) {
  $fullPath = Join-Path $src $item
  if (Test-Path $fullPath -PathType Leaf) {
    $rel = $item
    $entry = $zip.CreateEntry($rel)
    $st = $entry.Open()
    $bytes = [IO.File]::ReadAllBytes($fullPath)
    $st.Write($bytes, 0, $bytes.Length)
    $st.Close()
  }
  elseif (Test-Path $fullPath -PathType Container) {
    Get-ChildItem $fullPath -Recurse -File | ForEach-Object {
      $rel = ($_.FullName.Substring($src.Length + 1)) -replace [regex]::Escape('\'), '/'
      $entry = $zip.CreateEntry($rel)
      $st = $entry.Open()
      $bytes = [IO.File]::ReadAllBytes($_.FullName)
      $st.Write($bytes, 0, $bytes.Length)
      $st.Close()
    }
  }
}

$zip.Dispose()

$z = Get-Item $out
Write-Host ("Created: $out")
Write-Host ("Size: " + [math]::Round($z.Length / 1KB) + " KB")
Write-Host ""
Write-Host "Contents:"
$r = [System.IO.Compression.ZipFile]::OpenRead($out)
$r.Entries | ForEach-Object { $_.FullName } | Sort-Object
$r.Dispose()

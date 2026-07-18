param(
  [string]$Source = "",
  [string]$OutputPng = "",
  [string]$OutputIco = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Source) {
  $Source = Join-Path $repoRoot "Logo\REF FLOW LOGO-02.png"
}
if (-not $OutputPng) {
  $OutputPng = Join-Path $repoRoot "assets\referenceflow.png"
}
if (-not $OutputIco) {
  $OutputIco = Join-Path $repoRoot "assets\referenceflow.ico"
}

Add-Type -AssemblyName System.Drawing

function New-SquareLogoPngBytes {
  param(
    [System.Drawing.Image]$Image,
    [int]$Size
  )

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

      $padding = [Math]::Max(1, [Math]::Round($Size * 0.055))
      $available = $Size - (2 * $padding)
      $scale = [Math]::Min($available / $Image.Width, $available / $Image.Height)
      $width = [Math]::Max(1, [Math]::Round($Image.Width * $scale))
      $height = [Math]::Max(1, [Math]::Round($Image.Height * $scale))
      $x = [Math]::Round(($Size - $width) / 2)
      $y = [Math]::Round(($Size - $height) / 2)
      $graphics.DrawImage($Image, $x, $y, $width, $height)
    } finally {
      $graphics.Dispose()
    }

    $stream = New-Object System.IO.MemoryStream
    try {
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      return $stream.ToArray()
    } finally {
      $stream.Dispose()
    }
  } finally {
    $bitmap.Dispose()
  }
}

$sourceImage = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Source))
try {
  $pngBytes = New-SquareLogoPngBytes -Image $sourceImage -Size 1024
  [System.IO.File]::WriteAllBytes($OutputPng, $pngBytes)

  $sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
  $entries = @($sizes | ForEach-Object {
    [PSCustomObject]@{
      Size = $_
      Bytes = New-SquareLogoPngBytes -Image $sourceImage -Size $_
    }
  })

  $fileStream = [System.IO.File]::Open($OutputIco, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  try {
    $writer = New-Object System.IO.BinaryWriter($fileStream)
    try {
      $writer.Write([UInt16]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]$entries.Count)

      $offset = 6 + (16 * $entries.Count)
      foreach ($entry in $entries) {
        $dimension = if ($entry.Size -ge 256) { 0 } else { $entry.Size }
        $writer.Write([Byte]$dimension)
        $writer.Write([Byte]$dimension)
        $writer.Write([Byte]0)
        $writer.Write([Byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$entry.Bytes.Length)
        $writer.Write([UInt32]$offset)
        $offset += $entry.Bytes.Length
      }

      foreach ($entry in $entries) {
        $writer.Write([Byte[]]$entry.Bytes)
      }
    } finally {
      $writer.Dispose()
    }
  } finally {
    $fileStream.Dispose()
  }
} finally {
  $sourceImage.Dispose()
}

Write-Output "Generated $OutputPng and $OutputIco from $Source"

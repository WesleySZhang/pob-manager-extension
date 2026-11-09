# Runs tools/pob_fields.lua in headless PoB v2.67.2 (PoE-Sim's pinned checkout and LuaJIT build).
# Usage: tools\pob_fields.ps1 <list file> <output .jsonl> [-PoeSim <path to PoE-Sim repo>]
param([Parameter(Mandatory)][string]$List, [Parameter(Mandatory)][string]$Out, [string]$PoeSim = "")
$ErrorActionPreference = 'Stop'
# $PSScriptRoot is empty in param() defaults under Windows PowerShell 5.1 -File, so the default is set here.
if (-not $PoeSim) { $PoeSim = Join-Path $PSScriptRoot "../../PoE-Sim" }
$Sim = (Resolve-Path $PoeSim).Path -replace '\\', '/'
$ListPath = (Resolve-Path $List).Path -replace '\\', '/'
$OutPath = [System.IO.Path]::GetFullPath($Out) -replace '\\', '/'
$Script = (Resolve-Path "$PSScriptRoot/pob_fields.lua").Path -replace '\\', '/'
$Tools = $PSScriptRoot -replace '\\', '/'
$Lj = "$Sim/.local/luajit"
Push-Location "$Sim/sources/pob/src"
try {
	$env:LUA_PATH = "../runtime/lua/?.lua;../runtime/lua/?/init.lua;./?.lua;$Lj/lua/?.lua;;"
	$env:LUA_CPATH = "$Lj/?.dll;;"
	& "$Lj/luajit.exe" -joff -e "LIST_FILE='$ListPath'; OUT_FILE='$OutPath'; TOOLS_DIR='$Tools'; dofile('HeadlessWrapper.lua'); dofile('$Script')"
	exit $LASTEXITCODE
} finally { Pop-Location }

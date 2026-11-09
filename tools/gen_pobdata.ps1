# Regenerates data/pobdata.js from headless Path of Building v2.67.2, using the PoE-Sim repo's pinned PoB
# checkout and LuaJIT build. Usage: tools\gen_pobdata.ps1 [-PoeSim <path to PoE-Sim repo>]
param([string]$PoeSim = "")
$ErrorActionPreference = 'Stop'
# $PSScriptRoot is empty in param() defaults under Windows PowerShell 5.1 -File, so the default is set here.
if (-not $PoeSim) { $PoeSim = Join-Path $PSScriptRoot "../../PoE-Sim" }
$Sim = (Resolve-Path $PoeSim).Path -replace '\\', '/'
$Out = ((Resolve-Path "$PSScriptRoot/..").Path -replace '\\', '/') + "/data/pobdata.js"
$Script = (Resolve-Path "$PSScriptRoot/gen_pobdata.lua").Path -replace '\\', '/'
$Lj = "$Sim/.local/luajit"
Push-Location "$Sim/sources/pob/src"
try {
	$env:LUA_PATH = "../runtime/lua/?.lua;../runtime/lua/?/init.lua;./?.lua;$Lj/lua/?.lua;;"
	$env:LUA_CPATH = "$Lj/?.dll;;"
	& "$Lj/luajit.exe" -joff -e "OUT_FILE='$Out'; dofile('HeadlessWrapper.lua'); dofile('$Script')"
	exit $LASTEXITCODE
} finally { Pop-Location }

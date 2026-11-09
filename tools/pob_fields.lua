-- Headless Path of Building v2.67.2: loads each build listed in LIST_FILE (one XML path per line) and writes what PoB
-- itself sees to OUT_FILE as JSON lines. tools/accuracy.js compares this with src/buildinfo.js. Run via tools/pob_fields.ps1.
--   className, ascendancy, level  build.spec / build.characterLevel after load
--   mainSkill   calcsTab.mainEnv.player.mainSkill (CalcSetup.lua selects it from the main socket group)
--   keystones   allocated tree nodes of type Keystone (after timeless jewel conversion), plus keystones merged from
--               mods (CalcPerform.lua modLib.mergeKeystones -> env.keystonesAdded)
--   uniques     unique/relic items in env.player.itemList (worn gear and socketed jewels), env.flaskSlotMap, env.tinctures
local json = require("dkjson")
local outFile = assert(io.open(OUT_FILE, "wb"))

-- Real zlib Inflate through tools/inflate.js (HeadlessWrapper's is a stub returning "").
local tmpIn, tmpOut = OUT_FILE .. ".inflate-in", OUT_FILE .. ".inflate-out"
function Inflate(data)
	local f = assert(io.open(tmpIn, "wb")); f:write(data); f:close()
	os.remove(tmpOut)
	if not os.execute(('node "%s/inflate.js" "%s" "%s"'):format(TOOLS_DIR, tmpIn, tmpOut)) then return nil end
	local g = io.open(tmpOut, "rb")
	if not g then return nil end
	local s = g:read("*a"); g:close()
	return s
end

local function readFile(p)
	local f = assert(io.open(p, "rb"), "cannot open " .. p)
	local s = f:read("*a"); f:close(); return s
end

local function sortedKeys(t)
	local out = {}
	for k in pairs(t) do out[#out + 1] = k end
	table.sort(out)
	return out
end

local function checkPrompt()
	-- A Lua error inside PoB (Launch.lua ShowErrMsg) leaves a prompt that stops every later frame; report it
	-- as this build's error and clear it so the next build loads.
	if launch.promptMsg then
		local msg = launch.promptMsg
		launch.promptMsg = nil
		error("PoB error: " .. msg:gsub("\n", " "):sub(1, 300))
	end
end

-- What PoB shows for the current state of the loaded build.
local function currentFields()
	local env = build.calcsTab.mainEnv
	local main = env.player.mainSkill
	local keystones, uniques = {}, {}
	for _, node in pairs(build.spec.allocNodes) do
		if node.type == "Keystone" then keystones[node.dn or node.name] = true end
	end
	for name in pairs(env.keystonesAdded or {}) do keystones[name] = true end
	local function addItem(item)
		if item and (item.rarity == "UNIQUE" or item.rarity == "RELIC") then uniques[item.title or item.name] = true end
	end
	for _, item in pairs(env.player.itemList) do addItem(item) end
	for item in pairs(env.flaskSlotMap or {}) do addItem(item) end
	for item in pairs(env.tinctures or {}) do addItem(item) end
	local asc = build.spec.curAscendClassName
	return {
		className = build.spec.curClassName,
		ascendancy = (asc and asc ~= "None") and asc or json.null,
		mainSkill = main and main.activeEffect and main.activeEffect.grantedEffect.name or json.null,
		keystones = sortedKeys(keystones),
		uniques = sortedKeys(uniques),
	}
end

for path in readFile(LIST_FILE):gmatch("[^\r\n]+") do
	local ok, err = pcall(function()
		loadBuildFromXML(readFile(path), "check")
		checkPrompt()
		-- Loadouts: the build's loadout drop-down (Build.lua SyncLoadouts), each selected in turn through the
		-- drop-down's own handler, then recalculated.
		local names = {}
		for _, v in ipairs(build.controls.buildLoadouts.list) do
			if type(v) == "string" and not v:match("^%^7%^7") and v ~= "No Loadouts" then names[#names + 1] = v end
		end
		local saved = currentFields() -- before any loadout is selected: the build as saved
		local loadouts = {}
		for _, name in ipairs(names) do
			local idx
			for j, v in ipairs(build.controls.buildLoadouts.list) do if v == name then idx = j end end
			build.controls.buildLoadouts.selFunc(idx, name)
			build.buildFlag = true
			runCallback("OnFrame")
			checkPrompt()
			local f = currentFields()
			f.name = name
			loadouts[#loadouts + 1] = f
		end
		saved.file = path
		saved.level = build.characterLevel
		saved.loadouts = loadouts
		outFile:write(json.encode(saved), "\n")
	end)
	if not ok then outFile:write(json.encode({ file = path, error = tostring(err) }), "\n") end
end
outFile:close()
print("done")

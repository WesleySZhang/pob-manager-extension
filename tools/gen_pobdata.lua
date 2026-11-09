-- Generates data/pobdata.js from Path of Building v2.67.2 (b32759a), run headless through tools/gen_pobdata.ps1.
-- Exports only what the build reader needs (src/buildinfo.js):
--   trees:  every entry of GameVersions.lua treeVersionList: display, num, keystone node id -> name
--           (TreeData/<v>/tree.lua nodes with isKeystone), classes and ascendancies, alternate ascendancies (bloodlines).
--   gems:   data.gems (Data/Gems.lua, set up in Modules/Data.lua setupGem): name, gameId, variantId, grantedEffectList ids.
--   skills: data.skills: name and the flags CalcSetup uses to build a socket group's skill list
--           (support, unsupported, hasGlobalEffect; Modules/CalcSetup.lua "Create active skills").
local out = OUT_FILE
local json = require("dkjson")

local trees = {}
for _, v in ipairs(treeVersionList) do
	local t = dofile("TreeData/" .. v .. "/tree.lua")
	local keystones = {}
	for _, node in pairs(t.nodes) do
		if type(node) == "table" and node.isKeystone and node.skill then keystones[tostring(node.skill)] = node.name end
	end
	local classes = {}
	for i, c in ipairs(t.classes) do
		local asc = {}
		for j, a in ipairs(c.ascendancies or {}) do asc[j] = a.name end
		classes[i] = { name = c.name, ascendancies = asc }
	end
	local alt = {}
	for i, a in ipairs(t.alternate_ascendancies or {}) do alt[i] = a.name end
	-- Cluster jewel sockets: { size, index, parent socket id or false } from each node's expansionJewel. PassiveSpec.lua
	-- BuildSubgraph numbers a cluster jewel's nodes from its socket chain: 0x10000, + (index << 6) for a large socket,
	-- + (index << 9) for a medium one, nothing for a small one, then + (jewel sizeIndex << 4). Only large sockets
	-- (size 2) start a chain (PassiveSpec.lua BuildClusterJewelGraphs).
	local clusterSockets = {}
	for _, node in pairs(t.nodes) do
		if type(node) == "table" and node.expansionJewel and node.skill then
			local ej = node.expansionJewel
			clusterSockets[tostring(node.skill)] = { ej.size, ej.index, ej.parent and tostring(ej.parent) or false }
		end
	end
	trees[v] = { display = treeVersions[v].display, num = treeVersions[v].num, keystones = keystones, classes = classes, alternateAscendancies = alt, clusterSockets = clusterSockets }

	-- Timeless jewels (Classes/PassiveSpec.lua BuildAllDependsAndPaths): a conquering jewel in a socket replaces every
	-- keystone in its radius with the legion keystone "<conqueror type>_keystone_<conqueror id>". Export, per socket and
	-- radius index, the keystones in radius (the loaded PassiveTree's nodesInRadius), the radius labels (data.jewelRadius
	-- for this version) and the legion keystone names (tree.legion.nodes).
	data.setJewelRadiiGlobally(v) -- sets data.jewelRadius (returns nothing)
	local radii = {}
	for index, r in pairs(data.jewelRadius) do radii[r.label] = radii[r.label] or index end
	local ok, ptree = pcall(function() return main:LoadTree(v) end)
	local socketKeystones, legionKeystones, keystoneMapNames, ringSlotNodes = {}, {}, {}, {}
	if ok and ptree then
		-- keystoneMap (PassiveTree.lua): tree keystones plus legion keystones. modLib.mergeKeystones only applies a
		-- "Keystone" mod whose name is in it.
		for name, node in pairs(ptree.keystoneMap) do
			if type(node) == "table" and node.dn == name then keystoneMapNames[#keystoneMapNames + 1] = name end
		end
		table.sort(keystoneMapNames)
		-- Nodes granting "+1 Ring Slot" (ModParser.lua: AdditionalRingSlot); CalcSetup.lua ignores Ring 3 without one.
		for id, node in pairs(ptree.nodes) do
			for _, line in ipairs(node.sd or {}) do
				if line:lower() == "+1 ring slot" then ringSlotNodes[#ringSlotNodes + 1] = tostring(id) end
			end
		end
		table.sort(ringSlotNodes)
		for id, node in pairs(ptree.nodes) do
			if node.type == "Socket" and node.nodesInRadius then
				local byRadius = {}
				for radiusIndex, inRadius in pairs(node.nodesInRadius) do
					local ks = {}
					for otherId, other in pairs(inRadius) do
						if other.type == "Keystone" and not other.ascendancyName then ks[#ks + 1] = tostring(otherId) end
					end
					table.sort(ks)
					if #ks > 0 then byRadius[tostring(radiusIndex)] = ks end
				end
				if next(byRadius) then socketKeystones[tostring(id)] = byRadius end
			end
		end
		for _, ln in ipairs((ptree.legion and ptree.legion.nodes) or {}) do
			if type(ln.id) == "string" and ln.id:match("_keystone_") then legionKeystones[ln.id] = ln.dn end
		end
	end
	trees[v].radii = radii
	trees[v].socketKeystones = socketKeystones
	trees[v].legionKeystones = legionKeystones
	trees[v].keystoneMapNames = keystoneMapNames
	trees[v].ringSlotNodes = ringSlotNodes
end
data.setJewelRadiiGlobally(latestTreeVersion)

-- Item lines that are a keystone: ModParser.lua specialModList entries built from data.keystones (Data.lua) and
-- data.clusterJewels.keystones, matched against the whole lower-cased line.
local itemKeystones = {}
for _, n in ipairs(data.keystones) do itemKeystones[#itemKeystones + 1] = n end
for _, n in ipairs(data.clusterJewels.keystones) do itemKeystones[#itemKeystones + 1] = n end
table.sort(itemKeystones)
-- Large cluster jewel keystones ("Adds <keystone>", ModParser.lua clusterJewelSkills).
local clusterKeystones = {}
for _, n in ipairs(data.clusterJewels.keystones) do clusterKeystones[#clusterKeystones + 1] = n end

local gems = {}
for id, g in pairs(data.gems) do
	local effects = {}
	for i = 1, 2 do
		local e = g.grantedEffectList[i]
		if e then effects[#effects + 1] = e.id end
	end
	gems[id] = { n = g.name, g = g.gameId, v = g.variantId, s = g.grantedEffectId, e = effects }
end

-- The skill types (Data/Global.lua SkillType) src/buildinfo.js uses to tell damage skills from utility ones.
local typeNames = { "Attack", "Damage", "DamageOverTime", "Minion", "CreatesMinion", "Travel", "Blink", "Aura", "Herald", "Guard",
	"Banner", "Buff", "AppliesCurse", "Hex", "Mark", "Warcry" }
local skills = {}
for id, s in pairs(data.skills) do
	if type(s) == "table" and s.name then
		local e = { n = s.name }
		if s.support then e.sup = 1 end
		if s.unsupported then e.uns = 1 end
		if s.hasGlobalEffect then e.glob = 1 end
		local t = {}
		for _, name in ipairs(typeNames) do
			if s.skillTypes and SkillType[name] and s.skillTypes[SkillType[name]] then t[#t + 1] = name end
		end
		if #t > 0 then e.t = t end
		skills[id] = e
	end
end

local body = json.encode({ pob = "v2.67.2 (b32759a)", latestTree = latestTreeVersion, treeOrder = treeVersionList, itemKeystones = itemKeystones, clusterKeystones = clusterKeystones, trees = trees, gems = gems, skills = skills }, { keyorder = {} })
local f = assert(io.open(out, "wb"))
f:write("// Generated by tools/gen_pobdata.lua from Path of Building v2.67.2 (b32759a). Do not edit by hand.\n")
f:write("(function (root) {\n  \"use strict\";\n  const data = ", body, ";\n")
f:write("  if (typeof module !== \"undefined\" && module.exports) module.exports = data;\n  else root.PobData = data;\n")
f:write("})(typeof globalThis !== \"undefined\" ? globalThis : this);\n")
f:close()
print("wrote " .. out)

// EVE Online ship type names — used to exclude ship names from character name detection in intel feeds.
// Source: EVE SDE / ESI. Update when new ships are added to the game.
export const EVE_SHIP_NAMES = new Set([
  // ── Frigates ──────────────────────────────────────────────────────────────
  'Atron','Tristan','Incursus','Navitas','Merlin','Kestrel','Bantam','Heron',
  'Rifter','Slasher','Probe','Breacher','Executioner','Punisher','Inquisitor',
  'Tormentor','Crucifier','Sigil','Condor','Ibis','Velator','Reaper','Impairor',
  // Faction frigates
  'Dramiel','Daredevil','Worm','Succubus','Cruor','Dagon','Worm',
  'Federation Navy Comet','Caldari Navy Hookbill','Imperial Navy Slicer',
  'Republic Fleet Firetail','Comet','Hookbill','Slicer','Firetail',
  // Interceptors
  'Taranis','Ares','Malediction','Stiletto','Crow','Raptor','Crusader','Malediction',
  // Assault Frigates
  'Enyo','Ishkur','Harpy','Hawk','Jaguar','Wolf','Retribution','Vengeance',
  // Covert Ops
  'Helios','Buzzard','Cheetah','Anathema',
  // Electronic Attack
  'Kitsune','Keres','Sentinel','Hyena',
  // Logistics Frigates
  'Deacon','Thalia','Kirin','Scalpel',
  // Misc
  'Magnate','Imicus','Burst','Vigil','Tormentor',

  // ── Destroyers ────────────────────────────────────────────────────────────
  'Catalyst','Cormorant','Coercer','Thrasher','Algos','Dragoon','Talwar','Sunesis',
  'Endurance','Prospect',
  // Interdictors
  'Sabre','Flycatcher','Heretic','Eris',
  // T3 Destroyers
  'Hecate','Jackdaw','Confessor','Svipul',
  // Command Destroyers
  'Bifrost','Stork','Magus','Pontifex',

  // ── Cruisers ──────────────────────────────────────────────────────────────
  'Thorax','Vexor','Celestis','Exequror','Osprey','Moa','Blackbird','Caracal',
  'Stabber','Rupture','Bellicose','Scythe','Omen','Maller','Arbitrator','Augoror',
  'Omen','Maller','Omen Navy Issue','Moa','Nomen',
  // Heavy Assault Cruisers
  'Ishtar','Zealot','Muninn','Eagle','Cerberus','Sacrilege','Vagabond','Deimos',
  // Recon
  'Lachesis','Arazu','Huginn','Rapier','Falcon','Rook','Curse','Pilgrim',
  // Heavy Interdictors
  'Onyx','Broadsword','Phobos','Devoter',
  // Logistics
  'Basilisk','Scimitar','Guardian','Oneiros',
  // T3 Cruisers
  'Tengu','Legion','Proteus','Loki',
  // Faction cruisers
  'Cynabal','Ashimmu','Phantasm','Vigilant','Gila','Orthrus','Stratios','Astero',
  'Barghest','Mordu','Federation Navy Omen','Omen Navy Issue',

  // ── Battlecruisers ────────────────────────────────────────────────────────
  'Drake','Ferox','Naga','Tornado','Hurricane','Brutix','Myrmidon','Oracle',
  'Harbinger','Prophecy','Talos','Cyclone','Ferox','Drake Navy Issue',
  'Hurricane Fleet Issue','Brutix Navy Issue','Harbinger Navy Issue',
  // Command Ships
  'Vulture','Nighthawk','Sleipnir','Claymore','Astarte','Eos','Absolution','Damnation',
  'Eos','Astarte',

  // ── Battleships ───────────────────────────────────────────────────────────
  'Raven','Scorpion','Rokh','Megathron','Hyperion','Dominix','Tempest',
  'Typhoon','Maelstrom','Armageddon','Apocalypse','Abaddon',
  // Faction/Navy battleships
  'Nightmare','Bhaalgorn','Machariel','Vindicator','Rattlesnake','Barghest',
  'Raven Navy Issue','Scorpion Navy Issue','Megathron Navy Issue','Tempest Fleet Issue',
  'Apocalypse Navy Issue','Armageddon Navy Issue','Typhoon Fleet Issue',
  // Marauders
  'Vargur','Paladin','Kronos','Golem',
  // Black Ops
  'Redeemer','Panther','Sin','Widow',

  // ── Capitals ──────────────────────────────────────────────────────────────
  // Dreadnoughts
  'Revelation','Phoenix','Naglfar','Moros','Chemosh','Caiman','Vehement','Molok',
  // Carriers
  'Archon','Thanatos','Nidhoggur','Chimera','Ninazu','Loggerhead',
  // Force Auxiliaries
  'Apostle','Minokawa','Lif','Ninazu',
  // Supercarriers
  'Aeon','Nyx','Wyvern','Hel','Vendetta','Revenant',
  // Titans
  'Avatar','Erebus','Ragnarok','Leviathan','Vanquisher','Komodo',
  // Industrial capitals
  'Rorqual','Orca','Porpoise',

  // ── Industrials & Misc ────────────────────────────────────────────────────
  'Badger','Tayra','Iteron','Mammoth','Bestower','Sigil','Nereus','Miasmos',
  'Obelisk','Fenrir','Charon','Providence','Rhea','Ark','Nomad','Anshar',
  'Bowhead','Kryos','Epithal','Miasmos',
  'Noctis','Venture','Endurance','Prospect',

  // ── Special / Event ships (commonly seen) ─────────────────────────────────
  'Dramiel','Cynabal','Machariel','Barghest','Orthrus','Garmur',
  'Worm','Gila','Rattlesnake','Daredevil','Vigilant','Vindicator',
  'Succubus','Cruor','Dagon','Bhaalgorn',
  'Astero','Stratios','Nestor',
  'Praxis','Gnosis','Sunesis','Apotheosis',
])

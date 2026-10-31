ASSET      CR_Koala (Mallee and Bramble share it; fur colour, scarf and leaf are separate and stay procedural)
CATEGORY   creature, biped-posed sitting animal (a koala), parts articulated by the game's own rig
VIEWS      ref/game-closeup.png: a perspective render of the current in-game koala, three-quarter, camera about 3 m,
           lens about 60 degrees vertical. Concept for silhouette and detail only, never for proportions.
           There is no orthographic sheet. Everything below is therefore INFERRED from the game's rig constants and
           general koala anatomy (large round head, wide ears, big nose, pear-shaped body, stocky limbs).
SCALE      Head top at 1.85 m. This is a cartoon koala about 3x life size so it reads from the game's chase camera
           (7.5 m, 60 degree lens: about 104 px per metre, so about 190 px tall on a 900 px screen). 1 unit = 1 m,
           Z up in Blender, the koala faces -Y, origin at the ground contact point.
PROPORTIONS head width : height 1.2 : 1; head width : torso width 1 : 1.0; ear diameter : head width 0.5;
           nose width : head width 0.24; arm length : torso height 0.46; leg length : torso height 0.34; eye spacing :
           head width 0.36. (all inferred; they match the constants the game's animation was written against)
PARTS      Head, Muzzle, Cheek.L/R, Nose, EarOuter.L/R, EarInner.L/R, Torso, Belly, ArmFur.L/R, PawArm.L/R,
           LegFur.L/R, PawLeg.L/R. Each is its own object with its origin at the joint the game rotates it about, so the
           game's existing pose code drives them unchanged. Eyes, mouth, claws, scarf and leaf stay procedural.
SILHOUETTE round head wider than the neck, big cupped ears, a large oval nose on a slight muzzle, full cheeks,
           pear-shaped body with haunches, short limbs.
MATERIALS  fur everywhere except the nose and paws; the game draws fur as shell layers cut by a strand texture, so the
           mesh needs smooth normals and a continuous, undistorted UV, not baked colour. No baked textures ship.
ARTICULATION the game's own rig (head, ears, arms, legs, torso breathing). No skeleton in the export. Sockets: none.
INFERRED   the whole back and underside, the ear cup depth, the haunches, the toes, the jaw. No reference covers them.
TARGET     engine three.js, GLB, budget: about 12 000 triangles for the whole koala (two koalas on screen), standard tier
           game camera: chase, elevation 11 degrees, distance 7.5 m, lens 60, subject about 190 px tall.

AS BUILT   19 parts, 11,024 triangles, 0.19 m of paw below the origin: the parts live in the game's rig space (the paw pivots hang
           below the body group), not at a ground-contact origin as the SCALE line says. Height with ears 1.94 m, paws to ears 2.13 m.

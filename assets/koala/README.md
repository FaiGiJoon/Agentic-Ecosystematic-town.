# CR_Koala

The koala's body, modelled in Blender and shipped as `public/grove/assets/CR_Koala.glb`.

| Path | What |
| --- | --- |
| `asset-brief.md` | The brief: parts, scale, budget, what is inferred. |
| `build/03_forms.py` | Builds all 19 parts into the master scene. Re-runnable. |
| `exports/` | The GLB, `asset-manifest.json`, `animation-contract.json`. |
| `CR_Koala_master.blend`, `review/`, `ref/` | Not in git (see `.gitignore`); rebuild below. |

Rebuild (Blender 4.5 and the `blender-image-to-3d` skill from https://github.com/majidmanzarpour/blender-game-skills,
installed as `~/.claude/skills/blender-image-to-3d`). Use absolute paths for `--out`: relative ones resolve
against Blender's own folder.

```bash
S=~/.claude/skills/blender-image-to-3d/scripts
blender --background --python $S/init_master.py -- --name CR_Koala --height 1.85 --ref-extra ref/game-closeup.png --subject-frac 0.88 --ground-frac 0.04 --cell 2.0 --cam-elev 11 --cam-az 20 --cam-dist 7.5 --cam-lens 50
blender --background --python build/03_forms.py -- --master CR_Koala_master.blend
blender --background --python $S/validate.py -- --blend $PWD/CR_Koala_master.blend --collections LOW --budget-tris 12000 --require-uv
blender --background --python $S/export_delivery.py -- --blend $PWD/CR_Koala_master.blend --out $PWD/exports --name CR_Koala --format GLB --collections LOW --no-animation --engine three.js
cp exports/CR_Koala.glb ../../public/grove/assets/CR_Koala.glb
```

`ref/game-closeup.png` is a screenshot of the old in-game koala; take a new one from the game if it is missing.

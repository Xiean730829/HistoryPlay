# Galaxy river environment texture

`galaxy-emission-ribbon-v1.png` is the local AI-generated environment texture from the supplied `D:\7\History\environment-backgrounds\v2` batch.

- Model: Qiniu `gpt-image-2`; generated once, with no retry.
- Size: 2048 × 1152 RGB PNG, 3,100,166 bytes, no alpha channel.
- SHA-256: `8bea2f41531d25dae02c88b211ab8cd04c30300e7fa765d7a226c62790839902`.
- Original file was copied without cropping, recoloring, or re-encoding.
- The image is a visual texture, not astronomical evidence. Its U axis runs along the route; V spans the river width. The S bend is formed by the shared scene geometry, not baked into the image.

The texture is additively composited over the continuous river surface. U maps from 0 to 1 once across the route to avoid repeating an unverified seam; its black RGB background is not treated as alpha.

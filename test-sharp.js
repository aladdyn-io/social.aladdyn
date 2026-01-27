const sharp = require("sharp");

console.log("Sharp version:", sharp.versions);

const svg = `<svg width="100" height="100"><rect width="100" height="100" fill="red"/></svg>`;

sharp(Buffer.from(svg))
  .png()
  .toBuffer()
  .then((buffer) => {
    console.log("Sharp works! Generated", buffer.length, "bytes");
  })
  .catch((error) => {
    console.error("Sharp error:", error.message);
    console.error(error.stack);
  });

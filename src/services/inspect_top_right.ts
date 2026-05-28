import sharp from 'sharp';
import axios from 'axios';

async function test() {
  const imageUrl = 'http://localhost:9000/aladdyn/posts/4caaf013-cddd-4aea-9006-84a8e5a08e8e/1779557707633-af6dee06-fbb4-4aac-87e3-37f1b4c19e63.png';
  console.log(`Downloading composite image: ${imageUrl}`);
  
  try {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    
    const image = sharp(buffer);
    const metadata = await image.metadata();
    console.log(`Metadata: width=${metadata.width}, height=${metadata.height}`);
    
    // Crop top-right quadrant with 8% inset
    const width = metadata.width || 1080;
    const height = metadata.height || 1080;
    const boxWidth = Math.floor(width / 2);
    const boxHeight = Math.floor(height / 2);
    const offset = Math.floor((width * 8) / 100);
    
    const left = Math.floor(width / 2);
    const top = 0;
    const adjustedLeft = Math.max(0, left - offset);
    const adjustedTop = Math.max(0, top + offset);
    
    const croppedBuffer = await image
      .extract({
        left: adjustedLeft,
        top: adjustedTop,
        width: Math.min(boxWidth - offset, width - adjustedLeft),
        height: Math.min(boxHeight - offset, height - adjustedTop),
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
      
    const pixels = croppedBuffer.data;
    const channels = croppedBuffer.info.channels;
    const totalPixels = pixels.length / channels;
    
    let totalLuminance = 0;
    for (let i = 0; i < pixels.length; i += channels) {
      const r = pixels[i] / 255;
      const g = pixels[i + 1] / 255;
      const b = pixels[i + 2] / 255;
      
      const rL = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
      const gL = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
      const bL = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
      
      const lum = 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
      totalLuminance += lum;
    }
    
    const avgLuminance = totalLuminance / totalPixels;
    const isDark = avgLuminance < 0.45;
    console.log(`Quadrant top_right average luminance: ${avgLuminance}`);
    console.log(`isDarkBg: ${isDark}`);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
  }
}

test();

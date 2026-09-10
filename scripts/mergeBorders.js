import fs from "node:fs";

const adm0 = JSON.parse(fs.readFileSync("public/ukraine-border.geojson", "utf8"));
const adm1 = JSON.parse(fs.readFileSync("public/ukraine-oblasts.geojson", "utf8"));

const features = [];

// 1. Add state border features from ADM0
for (const feat of adm0.features) {
  features.push({
    type: "Feature",
    properties: { name: "Державний кордон України", type: "state_border" },
    geometry: feat.geometry
  });
}

// 2. Add oblast boundary features from ADM1
for (const feat of adm1.features) {
  const name = feat.properties.shapeName || "Область";
  features.push({
    type: "Feature",
    properties: { name, type: "oblast_border" },
    geometry: feat.geometry
  });
}

const merged = {
  type: "FeatureCollection",
  features
};

fs.writeFileSync("public/ukraine-official-borders.geojson", JSON.stringify(merged));
console.log("Merged features:", features.length, "Saved to public/ukraine-official-borders.geojson");

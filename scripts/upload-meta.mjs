/** Pins token metadata (description + image) on Flap's IPFS gateway and
 *  prints the resulting META_CID, per docs.flap.sh's GraphQL multipart
 *  upload spec (Node 18+, no deps — uses global fetch/FormData/Blob).
 *
 *  Usage: node scripts/upload-meta.mjs
 */
import { readFile } from "node:fs/promises";

const IMAGE_PATH = "/Users/aske/Downloads/RH.png";
const CREATOR = "0xb267b6ec60d1ef728463629ac236a395225858f0";
const DESCRIPTION = "TEST RUN";
const WEBSITE = "https://google.com";
const TWITTER = "https://x.com";
const TELEGRAM = null;

const MUTATION = `
mutation Create($file: Upload!, $meta: MetadataInput!) {
  create(file: $file, meta: $meta)
}
`;

const form = new FormData();
form.append(
  "operations",
  JSON.stringify({
    query: MUTATION,
    variables: {
      file: null,
      meta: {
        website: WEBSITE,
        twitter: TWITTER,
        telegram: TELEGRAM,
        description: DESCRIPTION,
        creator: CREATOR,
      },
    },
  }),
);
form.append("map", JSON.stringify({ "0": ["variables.file"] }));

const bytes = await readFile(IMAGE_PATH);
form.append("0", new Blob([bytes], { type: "image/png" }), "image.png");

const res = await fetch("https://funcs.flap.sh/api/upload", {
  method: "POST",
  body: form,
});
const json = await res.json();

if (!res.ok || json.errors) {
  console.error("upload failed:", JSON.stringify(json, null, 2));
  process.exit(1);
}

console.log("META_CID =", json.data.create);

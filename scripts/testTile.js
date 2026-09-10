fetch("https://mt1.google.com/vt/lyrs=s&x=147&y=89&z=8")
  .then(r => console.log("Google Status:", r.status, "Type:", r.headers.get("content-type")))
  .catch(e => console.error(e));

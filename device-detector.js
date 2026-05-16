function detect(userAgent) {
  const isKindle = userAgent.includes("Kindle");
  const isKobo = userAgent.includes("Kobo");
  const isTolino = userAgent.toLowerCase().includes("tolino");
  const isEReader = userAgent.includes("eReader");

  const isEreader = isKindle || isKobo || isTolino || isEReader;

  return {
    isKindle,
    isKobo,
    isTolino,
    isEReader,
    pageType: isEreader ? "download" : "upload",
    conversionTool: isKindle ? "kindlegen" : isKobo ? "kepubify" : null,
  };
}

module.exports = { detect };

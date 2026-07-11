# tessdata (vendored)

`deu.traineddata.gz` — German LSTM model, **tessdata_fast** (fastest, ~0.8 MB
gzipped). Committed so the spike needs no network at run time; `engineNode.ts`
points Tesseract's `langPath` here with `gzip: true`.

Source (tesseract.js CDN, mirrors `tesseract-ocr/tessdata_fast`):

```
https://tessdata.projectnaptha.com/4.0.0_fast/deu.traineddata.gz
```

Re-fetch / upgrade:

```bash
curl -L -o deu.traineddata.gz https://tessdata.projectnaptha.com/4.0.0_fast/deu.traineddata.gz
```

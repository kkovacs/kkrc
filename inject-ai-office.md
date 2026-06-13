

## Extract markdown from PDF, DOCX, or XLSX files

### PDF → markdown

```bash
uvx --from pymupdf4llm python -c "import pymupdf4llm, sys; print(pymupdf4llm.to_markdown(sys.argv[1]))" file.pdf
```

### XLSX, DOCX, PPTX → markdown

```bash
uvx --from "markitdown[xlsx]" markitdown file.xlsx
```

Multi-sheet workbooks get one `## <sheet name>` H2 per sheet. Column headers from row 1 are preserved, merged title cells appear in column A with `Unnamed: N` filling the rest, sparse label/value sheets (e.g. "Notes") come through cleanly.

Other `markitdown` extras: `markitdown[pdf,docx,xlsx,xls,pptx,outlook]`



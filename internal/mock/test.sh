#!/bin/bash

curl -X POST \
  'http://localhost:8080/api/basic/score' \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "This is a sample article content used to verify the scoring API. The system should compute credibility and reproducibility scores based on the provided text.",
    "title": "Sample Article Title"
}'


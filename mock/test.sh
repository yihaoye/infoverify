#!/bin/bash

curl -X POST \
  'http://localhost:8080/api/basic/check' \
  -H 'Content-Type: application/json' \
  -d '{
    "article": {
        "title": "Sample Article Title",
        "content": "This is the main content of the article. It can contain multiple paragraphs and detailed information.",
        "author": "John Doe"
    }
}'

curl -X GET 'http://localhost:8080/api/basic/get?id=f6a1a349-b62a-4df1-8f74-188dfc5fa86f'

curl -X GET 'http://localhost:9200/articles/_search'

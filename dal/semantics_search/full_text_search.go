package semantics_search

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/elastic/go-elasticsearch/v8"
)

// ES
func Demo() {
	// Create a client to interact with Elasticsearch
	es, err := elasticsearch.NewClient(elasticsearch.Config{
		Addresses: []string{"http://localhost:9200"},
	})
	if err != nil {
		log.Fatalf("Error creating the client: %s", err)
	}

	// Index a document
	document := `{
		"title": "Elasticsearch in Go",
		"content": "This is a sample document indexed with Go."
	}`
	_, err = es.Index(
		"articles", // Index name
		strings.NewReader(document),
		es.Index.WithDocumentID("1"), // Optionally specify a document ID
		es.Index.WithRefresh("true"), // Refresh after indexing
	)

	// Handle errors during indexing
	if err != nil {
		log.Fatalf("Error indexing document: %s", err)
	}
	fmt.Println("Document indexed successfully!")

	// Wait a moment for the index to be ready
	time.Sleep(2 * time.Second)

	// Search for the indexed document
	searchResponse, err := es.Search(
		es.Search.WithIndex("articles"),
		es.Search.WithQuery(`{"match": {"content": "Go"}}`), // Match query
		es.Search.WithSize(10),                              // Number of results
	)

	if err != nil {
		log.Fatalf("Error searching documents: %s", err)
	}
	defer searchResponse.Body.Close()

	// Print the search results
	fmt.Println("Search results:")
	var response map[string]interface{}
	if err := json.NewDecoder(searchResponse.Body).Decode(&response); err != nil {
		log.Fatalf("Error parsing the response body: %s", err)
	}

	// Output the search hits
	hits := response["hits"].(map[string]interface{})["hits"].([]interface{})
	for _, hit := range hits {
		fmt.Printf("%v\n", hit)
	}
}

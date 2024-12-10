package semantics_search

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/elastic/go-elasticsearch/v8"
)

// Article represents the structure of an article document
type Article struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Content string `json:"content"`
	Author  string `json:"author"`
}

// ESClient wraps the Elasticsearch client
type ESClient struct {
	client *elasticsearch.Client
	index  string
}

var (
	ArticleESClient *ESClient
)

// NewESClient creates a new Elasticsearch client
func Init() error {
	client, err := elasticsearch.NewClient(elasticsearch.Config{
		Addresses: []string{"http://localhost:9200"},
	})
	if err != nil {
		return fmt.Errorf("failed to create ES client: %w", err)
	}

	ArticleESClient = &ESClient{
		client: client,
		index:  "articles",
	}
	return nil
}

// IndexArticle indexes a single article. When "index" an article, we're essentially storing and making it searchable in Elasticsearch.
func (ec *ESClient) IndexArticle(article Article) error {
	articleJSON, err := json.Marshal(article)
	if err != nil {
		return fmt.Errorf("failed to marshal article: %w", err)
	}

	_, err = ec.client.Index(
		ec.index,
		strings.NewReader(string(articleJSON)),
		ec.client.Index.WithDocumentID(article.ID),
		ec.client.Index.WithRefresh("true"),
	)
	if err != nil {
		return fmt.Errorf("failed to index article: %w", err)
	}

	return nil
}

// BulkIndexArticles indexes multiple articles in bulk
func (ec *ESClient) BulkIndexArticles(articles []Article) error {
	if len(articles) == 0 {
		return errors.New("no articles to index")
	}

	var builder strings.Builder
	for _, article := range articles {
		// Add metadata
		metadata := map[string]interface{}{
			"index": map[string]interface{}{
				"_index": ec.index,
				"_id":    article.ID,
			},
		}
		metadataJSON, err := json.Marshal(metadata)
		if err != nil {
			return fmt.Errorf("failed to marshal metadata: %w", err)
		}
		builder.Write(metadataJSON)
		builder.WriteString("\n")

		// Add document
		articleJSON, err := json.Marshal(article)
		if err != nil {
			return fmt.Errorf("failed to marshal article: %w", err)
		}
		builder.Write(articleJSON)
		builder.WriteString("\n")
	}

	// Perform bulk indexing
	res, err := ec.client.Bulk(strings.NewReader(builder.String()))
	if err != nil {
		return fmt.Errorf("failed to perform bulk indexing: %w", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		return fmt.Errorf("bulk indexing failed: %s", res.String())
	}

	return nil
}

// SearchArticles searches for articles based on query []string
func (ec *ESClient) SearchArticles(query []string, size int) ([]Article, error) {
	// Construct the search query
	searchQuery := map[string]interface{}{
		"query": map[string]interface{}{
			"multi_match": map[string]interface{}{
				"query":  strings.Join(query, " "),
				"fields": []string{"title^2", "content", "author"}, // title has higher weight
			},
		},
	}

	searchJSON, err := json.Marshal(searchQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal search query: %w", err)
	}

	// Perform the search
	res, err := ec.client.Search(
		ec.client.Search.WithContext(context.Background()),
		ec.client.Search.WithIndex(ec.index),
		ec.client.Search.WithBody(strings.NewReader(string(searchJSON))),
		ec.client.Search.WithSize(size),
	)
	if err != nil {
		return nil, fmt.Errorf("search failed: %w", err)
	}
	defer res.Body.Close()

	// Parse the response
	var result map[string]interface{}
	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	// Extract hits
	hits := result["hits"].(map[string]interface{})["hits"].([]interface{})
	articles := make([]Article, 0, len(hits))

	for _, hit := range hits {
		source := hit.(map[string]interface{})["_source"]
		articleJSON, err := json.Marshal(source)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal hit source: %w", err)
		}

		var article Article
		if err := json.Unmarshal(articleJSON, &article); err != nil {
			return nil, fmt.Errorf("failed to unmarshal article: %w", err)
		}
		articles = append(articles, article)
	}

	return articles, nil
}

// DeleteArticle deletes an article by ID
func (ec *ESClient) DeleteArticle(id string) error {
	res, err := ec.client.Delete(ec.index, id)
	if err != nil {
		return fmt.Errorf("failed to delete article: %w", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		return fmt.Errorf("delete operation failed: %s", res.String())
	}

	return nil
}

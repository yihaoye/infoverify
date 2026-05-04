package utils

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

func CacheKey(input string) string {
	h := sha256.Sum256([]byte(input))
	return fmt.Sprintf("%x", h)
}

func IDFromURL(url string) string {
	hash := sha256.Sum256([]byte(url))
	return hex.EncodeToString(hash[:])
}

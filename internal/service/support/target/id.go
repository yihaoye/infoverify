package target

import (
	"crypto/sha256"
	"encoding/hex"
)

func IDFromURL(url string) string {
	hash := sha256.Sum256([]byte(url))
	return hex.EncodeToString(hash[:])
}

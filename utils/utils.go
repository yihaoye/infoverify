package utils

import (
	"strconv"

	"github.com/cespare/xxhash/v2"
)

// 使用 xxhash 对输入进行均匀哈希计算，然后对 100 进行取模来实现百分比分流
func HashMod(id int64) int32 {
	hash := xxhash.Sum64([]byte(strconv.FormatInt(id, 10)))
	return int32(hash % 100)
}

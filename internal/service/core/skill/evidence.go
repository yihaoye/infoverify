package skill

func ExtractEvidence(results []Result) []Evidence {
	// 汇总各技能输出的证据，便于 API 返回。
	if len(results) == 0 {
		return nil
	}
	out := make([]Evidence, 0)
	for _, r := range results {
		if len(r.Evidence) == 0 {
			continue
		}
		out = append(out, r.Evidence...)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

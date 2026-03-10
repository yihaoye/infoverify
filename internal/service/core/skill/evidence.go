package skill

func ExtractEvidence(results []Result) []Evidence {
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

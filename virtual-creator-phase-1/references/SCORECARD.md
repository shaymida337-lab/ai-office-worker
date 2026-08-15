# ROUND 1 SCORECARD

Score each criterion from 1–10 for every clip.

| Criterion | Weight |
|---|---:|
| Face / identity consistency | 30% |
| Motion naturalness | 20% |
| Expression quality | 15% |
| Hands / body integrity | 10% |
| Eeriness / uncanny penalty | 10% |
| Reference fidelity | 10% |
| First-pass usability | 5% |

## Hard-fail conditions
Any of these marks a clip FAILED regardless of average score:
- Clearly different face
- Eye/teeth/mouth deformation that viewers will notice
- Broken or impossible fingers/hands during a focal gesture
- Major age shift
- Hair/face identity changes mid-clip
- Obvious synthetic “AI slop” look

## Decision after 5 clips
- 5/5 usable: proceed to the 15-clip benchmark
- 4/5 usable: rerun only the failed clip once, then decide
- 3/5 or less usable: do NOT scale; change model/reference/prompt strategy first

## Cost tracking
For every attempt record:
- model
- generated seconds
- cost
- result: pass/fail
- failure reason
- number of attempts needed

Primary business metric:
COST PER APPROVED SECOND

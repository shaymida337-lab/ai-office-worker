# QA Rules — Finalist #2: The Sharp Observer

**Every output is tested before approval.**

---

## Round 1 QA Scope

Round 1 focus: **Character validation and motion stability**

**QA is testing:**
- Face identity consistency
- Motion naturalness
- Expression quality
- Gesture integrity
- Absence of uncanny feeling
- Visual quality baseline

**QA is NOT testing:**
- Finished content or branding
- Audio/voiceover
- Captions or text overlays
- Color grading or advanced post-production
- Viral potential or content fit
- Final platform optimization

---

## Motion Test Scorecard

**Rate each clip 1–10 on seven criteria:**

| Criterion | Weight | What We're Testing |
|---|---:|---|
| Face / Identity Consistency | 30% | Is it the same woman? Does face shape/features stay stable? |
| Motion Naturalness | 20% | Does movement look real or robotic? Does it have proper weight/physics? |
| Expression Quality | 15% | Do emotions read naturally? Do eyebrow/eye/mouth changes feel believable? |
| Hands / Body Integrity | 10% | Are hands/limbs realistic? No broken fingers or impossible geometry? |
| Eeriness / Uncanny Penalty | 10% | Does it feel creepy or uncanny? Or comfortably human? |
| Reference Fidelity | 10% | Does the generated clip resemble the reference image? |
| First-Pass Usability | 5% | Could we work with this as a foundation for future content? |

---

## Scoring Scale

### 1–3 Points
- **Unacceptable.** Major failure in this criterion.
- **Example:** Face completely changes, motion is jerky and robotic, obvious AI artifacts.

### 4–6 Points
- **Usable with concerns.** Notable issues but not disqualifying.
- **Example:** Occasional glitch, slight identity drift, motion is mostly natural.

### 7–8 Points
- **Good.** Minor issues only.
- **Example:** One moment where eye slightly blurs, but overall strong.

### 9–10 Points
- **Excellent.** No meaningful issues.
- **Example:** Stable identity, natural motion, believable expression throughout.

---

## Hard Fail Conditions

**A clip is FAILED regardless of score if:**

### Identity Failures
- ❌ Face clearly changes mid-clip
- ❌ Different person appears (face morph)
- ❌ Age significantly shifts (looks visibly older/younger)
- ❌ Hair color or style changes
- ❌ Eye color changes

### Physical Deformations
- ❌ Eyes cross or deform (if clearly wrong)
- ❌ Mouth melts, inverts, or breaks
- ❌ Teeth deform (if visible and wrong)
- ❌ Broken or impossible fingers during a focal gesture
- ❌ Neck breaks at unnatural angle
- ❌ Body proportions change (limbs too thin/thick mid-clip)

### Motion/Physics Failures
- ❌ Jerky, unnatural movement
- ❌ Weightless or floaty motion
- ❌ Movement doesn't match physics
- ❌ Limbs move independently from body

### Artifacting Failures
- ❌ Obvious "AI slop" appearance (melted edges, plastic texture)
- ❌ Glitch or frame skip mid-motion
- ❌ Character becomes visibly unrecognizable
- ❌ Heavy motion blur obscuring face identity

---

## Acceptable Issues (First Pass)

These are NOT hard failures:

- ✅ Slight compression artifacts (can clean up in post)
- ✅ Minor lighting inconsistency (can fix in grading)
- ✅ Hand position ambiguity if not focal gesture
- ✅ Very subtle uncanny moment (<0.5 seconds)
- ✅ Tiny pixel-level inconsistency

**Key:** If face is stable and identifiable throughout, we can work with it.

---

## Per-Clip Checklist

### Clip 01 — Neutral Talk
- ✅ Same face and features
- ✅ Natural eye contact with camera
- ✅ Natural blinking (not staring, not overdone)
- ✅ Subtle head movement (not jerky)
- ✅ Small natural hand gesture
- ✅ Calm, confident energy
- ✅ No exaggerated smile
- ✅ Natural mouth movement
- ✅ No camera shake or instability

**Pass if:** 4/5 above are strong, no hard fails

---

### Clip 02 — Skeptical Reaction
- ✅ Expression clearly changes
- ✅ Eyebrow raise is subtle but visible
- ✅ Side glance is natural
- ✅ Returns gaze to camera smoothly
- ✅ Restrained, dry humor reads
- ✅ Minimal body movement
- ✅ Photorealistic
- ✅ Same face identity throughout
- ✅ Expression is intelligible (not overly subtle)

**Pass if:** Expression change is clear and natural, no hard fails

---

### Clip 03 — Found It
- ✅ Expression shifts naturally
- ✅ Quiet satisfaction reads (not theatrical)
- ✅ Pointing gesture is natural and restrained
- ✅ Gesture is recognizable and intentional
- ✅ No dramatic flourishes
- ✅ Believable and smart
- ✅ Same woman throughout
- ✅ Transition feels smooth

**Pass if:** Gesture + expression feel intentional, no hard fails

---

### Clip 04 — Explaining
- ✅ One controlled hand gesture
- ✅ Slight head nod (or natural head movement)
- ✅ Warm but authoritative expression
- ✅ Looks like smart friend, not corporate presenter
- ✅ Natural hand position and movement
- ✅ Natural eye contact
- ✅ Natural facial movement
- ✅ No stiffness or artificial quality
- ✅ Conversational energy

**Pass if:** Hands/eyes/face are natural, no presenter stiffness, no hard fails

---

### Clip 05 — Walking
- ✅ Relaxed, natural walking pace
- ✅ Subtle arm swing (not stiff, not exaggerated)
- ✅ Confident stride
- ✅ Stable face identity (no morphing while moving)
- ✅ Realistic body motion and weight
- ✅ No runway-model posing
- ✅ Documentary/real feel
- ✅ Face stays recognizable throughout

**Pass if:** Body motion is believable and face doesn't drift, no hard fails

---

## Weighted Score Calculation

### Example
Clip rating:
- Face consistency: 8/10 (30% weight = 2.4 points)
- Motion naturalness: 7/10 (20% weight = 1.4 points)
- Expression: 8/10 (15% weight = 1.2 points)
- Hands/body: 7/10 (10% weight = 0.7 points)
- Uncanniness: 9/10 (10% weight = 0.9 points)
- Reference fidelity: 8/10 (10% weight = 0.8 points)
- Usability: 8/10 (5% weight = 0.4 points)

**Total: 7.8/10 = PASS**

---

## Decision Matrix After 5 Clips

| Passing Clips | Recommendation | Next Action |
|---|---|---|
| 5/5 usable | **PROCEED** | Advance to 15-clip benchmark |
| 4/5 usable | **RERUN 1 CLIP** | Re-attempt the failed clip once; if still fails, go to 4/5 proceed |
| 3/5 usable | **CHANGE STRATEGY** | Do NOT scale yet; investigate model/reference/prompt changes |
| 2/5 or less | **REJECT** | Finalist #2 may not be viable with current method |

---

## Cost Tracking QA

**Track every attempt:**
- Model used
- Generated seconds
- Estimated cost
- Pass/fail
- Failure reason
- Attempts before success

**Calculate:**
- Cost per approved clip
- Cost per approved second
- First-pass approval rate (%)
- Average attempts per approved clip

---

## Visual Quality Baseline

### For Round 1 (First Pass)
- Resolution: 1080p minimum
- Frame rate: 24fps or 30fps
- Aspect ratio: 9:16 vertical
- Face identity: Stable
- Motion: Smooth (no visible stuttering)
- No major artifacts: No visible glitches

### Color/Lighting
- Color temperature: Consistent per location
- Brightness: Not blown out or too dark
- Shadows: Soft (not harsh)
- Skin tone: Natural

### Audio (Not tested in Round 1)
- No audio included in first-pass clips
- Voice sync testing happens in Round 2

---

## Content QA (Future)

When content is created, add these checks:

- ✅ Identity stable throughout
- ✅ All factual claims have evidence or are labeled opinion
- ✅ No fabricated biography or experience
- ✅ Tone matches personality
- ✅ Audio/visual quality meets standards
- ✅ Captions accurate (if present)
- ✅ No sensitive domain violations
- ✅ Founder approved

---

## QA Sign-Off

**Round 1 QA Sign-Off Template:**

```
ROUND 1 MOTION TEST — QA SIGN-OFF

Date: [date]
Tester: [name]

Clips Generated: 5/5
Clips Passed: [X]/5

Scores:
- Clip 01 (Neutral Talk): [X]/10
- Clip 02 (Skeptical): [X]/10
- Clip 03 (Found It): [X]/10
- Clip 04 (Explaining): [X]/10
- Clip 05 (Walking): [X]/10

Average Score: [X]/10

Major Issues Found:
- [Issue 1]
- [Issue 2]

Cost Summary:
- Total cost: $[X]
- Attempts: [X]
- Cost per approved second: $[X]

Recommendation: [PROCEED / RERUN / CHANGE STRATEGY / REJECT]

Signed: [QA Tester]
```


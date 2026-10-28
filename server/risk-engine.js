/**
 * Risk Engine — Pure logic, no AI calls.
 * Aggregates issues from all workers + validator, computes running risk score.
 */
export class RiskEngine {
    constructor() {
        this.issues = [];
        this.score = 100; // Start at 100, deduct for issues
        this.level = 'low';
        this.listeners = [];
    }

    /** Subscribe to risk updates */
    onUpdate(fn) {
        this.listeners.push(fn);
    }

    _emit() {
        const summary = this.getSummary();
        for (const fn of this.listeners) {
            try { fn(summary); } catch { }
        }
    }

    /** Add an issue from a worker or validator */
    addIssue(source, issue) {
        const entry = {
            source,                          // 'worker-C', 'worker-D', 'validator'
            type: issue.type || 'unknown',
            severity: issue.severity || 'medium',
            message: issue.message || '',
            timestamp: Date.now(),
        };
        this.issues.push(entry);
        this._recalculate();
        this._emit();
    }

    /** Add multiple issues at once (from validator) */
    addBulkIssues(source, issues) {
        for (const issue of issues) {
            const entry = {
                source,
                type: issue.type || 'unknown',
                severity: issue.severity || 'medium',
                message: issue.message || '',
                timestamp: Date.now(),
            };
            this.issues.push(entry);
        }
        this._recalculate();
        this._emit();
    }

    _recalculate() {
        let deduction = 0;
        for (const issue of this.issues) {
            switch (issue.severity) {
                case 'critical': deduction += 15; break;
                case 'high': deduction += 8; break;
                case 'medium': deduction += 4; break;
                case 'low': deduction += 1; break;
            }
        }
        this.score = Math.max(0, Math.min(100, 100 - deduction));

        if (this.score >= 80) this.level = 'low';
        else if (this.score >= 60) this.level = 'medium';
        else if (this.score >= 40) this.level = 'high';
        else this.level = 'critical';
    }

    getSummary() {
        return {
            score: this.score,
            level: this.level,
            totalIssues: this.issues.length,
            breakdown: {
                critical: this.issues.filter(i => i.severity === 'critical').length,
                high: this.issues.filter(i => i.severity === 'high').length,
                medium: this.issues.filter(i => i.severity === 'medium').length,
                low: this.issues.filter(i => i.severity === 'low').length,
            },
        };
    }

    getAllIssues() {
        return this.issues;
    }
}

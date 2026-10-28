/**
 * Assemble the final report from all test results.
 * Updated for the goal-based agent loop.
 */
export function assembleReport(session, executionResult, validationIssues, aiReport) {
    const duration = Date.now() - session.startTime;

    // Combine AI-detected bugs with validation issues
    const allIssues = [
        ...validationIssues.map(issue => ({
            type: issue.type,
            severity: issue.severity,
            message: issue.message,
            source: 'validator',
        })),
        ...(executionResult.aiBugs || []).map(bug => ({
            type: bug.type || 'ai-detected',
            severity: bug.severity || 'medium',
            message: bug.message,
            source: 'ai-agent',
        })),
    ];

    return {
        // Meta
        url: session.url,
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        duration: duration,
        durationFormatted: formatDuration(duration),

        // Scores
        reliabilityScore: aiReport.reliability_score || 0,
        riskLevel: aiReport.risk_level || 'unknown',

        // AI Analysis
        siteType: session.siteType || 'unknown',
        summary: aiReport.summary || '',
        strengths: aiReport.strengths || [],
        recommendations: aiReport.recommendations || [],

        // Execution
        execution: {
            totalTasks: executionResult.totalGoals || executionResult.totalTasks,
            tasksCompleted: executionResult.goalsCompleted || executionResult.tasksCompleted,
            totalActions: executionResult.totalActions,
            successfulActions: executionResult.successfulActions,
            failedActions: executionResult.failedActions,
            pagesVisited: executionResult.pagesVisited || [],
        },

        // Task / Goal details
        tasks: (executionResult.goalResults || executionResult.taskResults || []).map(g => ({
            name: g.name,
            status: g.status,
            actionsCompleted: g.actionsCompleted,
            bugsFound: g.bugsFound || 0,
        })),

        // Timeline
        timeline: executionResult.timeline || [],

        // Issues (combined)
        issues: allIssues,
        issuesSummary: {
            total: allIssues.length,
            high: allIssues.filter(i => i.severity === 'high').length,
            medium: allIssues.filter(i => i.severity === 'medium').length,
            low: allIssues.filter(i => i.severity === 'low').length,
        },

        // Screenshots
        screenshots: session.events
            .filter(e => e.type === 'screenshot')
            .map(e => e.name || e.data?.name)
            .filter(Boolean),
    };
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
    return `${remainingSeconds}s`;
}

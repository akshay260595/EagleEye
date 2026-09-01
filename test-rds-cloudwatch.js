const {
    getRDSIdleMetrics,
    isRDSIdle
} = require("./cloudwatch");

async function main() {

    const region = "us-west-2";

    const dbInstanceIdentifier = process.argv[2];

    if (!dbInstanceIdentifier) {
        console.log("Usage:");
        console.log(
            "node test-rds-cloudwatch.js <DB_INSTANCE_IDENTIFIER>"
        );
        process.exit(1);
    }

    console.log(
        `Checking RDS instance: ${dbInstanceIdentifier}`
    );

    console.log(
        "Evaluating last 30 days...\n"
    );

    try {

        const metrics = await getRDSIdleMetrics(
            region,
            dbInstanceIdentifier,
            30
        );

        console.log("RDS CloudWatch Metrics");
        console.log("======================");

        console.log(
            "Average CPU:",
            metrics.avgCpu.toFixed(2),
            "%"
        );

        console.log(
            "Average Connections:",
            metrics.avgConnections.toFixed(2)
        );

        console.log(
            "Average Read IOPS:",
            metrics.avgReadIOPS.toFixed(2)
        );

        console.log(
            "Average Write IOPS:",
            metrics.avgWriteIOPS.toFixed(2)
        );

        console.log(
            "Average Network In:",
            metrics.avgNetworkIn.toFixed(2)
        );

        console.log(
            "Average Network Out:",
            metrics.avgNetworkOut.toFixed(2)
        );

        console.log(
            "\nEvaluation Period:",
            metrics.evaluationDays,
            "days"
        );

        console.log("\nIdle Status:");

        if (isRDSIdle(metrics)) {
            console.log("🔴 IDLE CANDIDATE");
        } else {
            console.log("🟢 ACTIVE");
        }

    } catch (error) {

        console.error(
            "CloudWatch RDS error:",
            error.message
        );

        process.exit(1);
    }
}

main();

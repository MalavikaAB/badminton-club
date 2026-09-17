package ie.clubnight.config;

import java.util.List;

import org.springframework.beans.BeansException;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.EnvironmentAware;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Fails fast with a clear message before the JDBC pool is created when the
 * Supabase connection settings are missing from the environment.
 *
 * <p>Without this guard, Spring Boot/Hikari fails during SQL initialization
 * with a confusing runtime error:
 * {@code Driver org.postgresql.Driver claims to not accept jdbcUrl,
 * jdbc:postgresql://${SUPABASE_DB_HOST}...} - i.e. the {@code ${...}}
 * placeholders in {@code spring.datasource.url} were never replaced because
 * the environment variables are not set.</p>
 *
 * <p>Runs as a {@link BeanFactoryPostProcessor} so it is executed before any
 * singleton bean (including the data source and SQL initializers) is created.</p>
 */
@Component
public class DatabaseEnvironmentGuard implements BeanFactoryPostProcessor, EnvironmentAware {

    private static final List<String> REQUIRED_VARIABLES = List.of(
            "SUPABASE_DB_HOST",
            "SUPABASE_DB_PORT",
            "SUPABASE_DB_NAME",
            "SUPABASE_DB_USERNAME",
            "SUPABASE_DB_PASSWORD");

    private Environment environment;

    @Override
    public void setEnvironment(Environment environment) {
        this.environment = environment;
    }

    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) throws BeansException {
        List<String> missing = REQUIRED_VARIABLES.stream()
                .filter(name -> !StringUtils.hasText(environment.getProperty(name)))
                .toList();
        if (!missing.isEmpty()) {
            throw new IllegalStateException(
                    "Missing Supabase database settings: " + String.join(", ", missing)
                            + ". Add them to your Render service (Environment tab) or to backend/.env, "
                            + "then redeploy. See DEPLOYMENT.md -> Troubleshooting.");
        }
    }
}
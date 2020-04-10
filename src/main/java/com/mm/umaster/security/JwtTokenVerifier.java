package com.mm.umaster.security;

import com.google.common.base.Strings;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.crypto.SecretKey;
import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

public class JwtTokenVerifier extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String authorizationHeader = request.getHeader(com.mm.umaster.security.SecurityConstants.TOKEN_HEADER);

        if (Strings.isNullOrEmpty(authorizationHeader) || !authorizationHeader.startsWith(SecurityConstants.TOKEN_PREFIX)) {
            filterChain.doFilter(request, response);
            return;
        }

        String token = authorizationHeader.replace(com.mm.umaster.security.SecurityConstants.TOKEN_PREFIX, "");

        try {
            SecretKey signingKey = Keys.hmacShaKeyFor(com.mm.umaster.security.SecurityConstants.SECRET_KEY.getBytes());

            Jws<Claims> claimsJws = Jwts.parserBuilder()
                    .setSigningKey(signingKey)
                    .build()
                    .parseClaimsJws(token);

            Claims body = claimsJws.getBody();
            String email = body.getSubject();

            Authentication authentication = new UsernamePasswordAuthenticationToken(
                    email,
                    null,
                    null
            );
            SecurityContextHolder.getContext().setAuthentication(authentication);
        } catch (JwtException e) {
            SecurityContextHolder.clearContext();
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            throw new IllegalStateException("Invalid token");
        }

        filterChain.doFilter(request, response);
    }
}

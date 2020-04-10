package com.mm.umaster.account.services;

import com.mm.umaster.account.error.UserAlreadyExistsException;
import com.mm.umaster.account.models.RoleType;
import com.mm.umaster.account.models.ShortUser;
import com.mm.umaster.account.models.User;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import com.mm.umaster.account.repositories.UserRepository;

import java.util.*;

@Service
public class UserService implements UserDetailsService {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    public ShortUser createNewUserAccount(User user) {
        if (this.emailExists(user.getEmail())) {
            throw new UserAlreadyExistsException(("There is an account with that email address: " + user.getEmail()));
        }

        User newAccount = new User();
        newAccount.setName(user.getName());
        newAccount.setPassword(passwordEncoder.encode(user.getPassword()));
        newAccount.setEmail(user.getEmail());
        newAccount.setRoles(Collections.singleton(RoleType.USER));

        return new ShortUser(userRepository.save(newAccount));
    }

    @Override
    public UserDetails loadUserByUsername(final String email) throws UsernameNotFoundException {
        User user = userRepository.findByEmail(email);

        if (user == null) {
            throw new UsernameNotFoundException("User " + email + " was not found");
        }
        return user;
    }

    public List<User> loadAllUsers() {
        return userRepository.findAll();
    }

    private boolean emailExists(String email) {
        return userRepository.findByEmail(email) != null;
    }
}